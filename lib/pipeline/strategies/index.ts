import type { ScanModeId, ScanStrategyId, ScanStrategy } from './types'
import { QuickStrategy } from './quick'
import { StandardStrategy } from './standard'
import { OrchestratedStrategy } from './orchestrated'
import { DiffStrategy } from './diff'
import { HuntStrategy } from './hunt'
import { PlaybookStrategy } from './playbook'

export type { ScanModeId, ScanStrategyId, StrategyContext, StrategyResult, ScanStrategy, DiffContext } from './types'

/** Matches a valid playbook mode: `playbook:{non-empty-name}@{non-empty-version}` */
const PLAYBOOK_SELECT_PATTERN = /^playbook:(.+)@(.+)$/

/**
 * Factory: select the appropriate strategy implementation for a given scan mode or strategy id.
 *
 * v0.2: Accepts 'diff' as a strategy id in addition to existing scan modes.
 * v0.3: Now async. Accepts 'hunt' and 'playbook:{name}@{version}' modes.
 * Unknown strategies fall back to 'standard' with no warning at this layer —
 * callers should normalize first via normalizeScanMode().
 *
 * @param mode - The scan strategy identifier.
 * @returns A Promise that resolves to the matching {@link ScanStrategy}.
 */
export async function selectStrategy(mode: ScanStrategyId): Promise<ScanStrategy> {
  switch (mode) {
    case 'diff':
      return new DiffStrategy()
    case 'quick':
      return new QuickStrategy()
    case 'standard':
      return new StandardStrategy()
    case 'intermediate':
      return new OrchestratedStrategy('intermediate')
    case 'paranoid':
      return new OrchestratedStrategy('paranoid')
    case 'hunt':
      // cveId resolved from ctx.prompt at run() time
      return new HuntStrategy()
    default: {
      // v0.3: playbook:name@version
      const match = PLAYBOOK_SELECT_PATTERN.exec(mode)
      if (match) {
        const [, name, version] = match
        return new PlaybookStrategy(`${name}@${version}`)
      }
      return new StandardStrategy()
    }
  }
}

/** Matches a valid playbook mode: `playbook:{non-empty-name}@{non-empty-version}` */
const PLAYBOOK_PATTERN = /^playbook:(.+)@(.+)$/

/**
 * Normalize a raw scan mode string into a valid ScanModeId.
 *
 * - Maps legacy `'deep'` → `'paranoid'` (with warning)
 * - Unknown values → `'standard'` (with warning)
 * - Valid modes pass through unchanged
 * - v0.3: `'hunt'` passes through unchanged
 * - v0.3: `'playbook:{name}@{version}'` passes through if name and version are non-empty;
 *   invalid playbook patterns (missing @version, empty name, or empty version) fall back to 'standard'
 *
 * NOTE: Does NOT normalize 'diff' — diff is a strategy, not a scan mode.
 * Use selectStrategy('diff') directly when creating diff scans.
 */
export function normalizeScanMode(
  raw: string | null | undefined,
  onWarn?: (msg: string) => void,
): ScanModeId {
  const valid = ['quick', 'standard', 'intermediate', 'paranoid', 'hunt'] as const

  if (raw && (valid as readonly string[]).includes(raw)) {
    return raw as ScanModeId
  }

  if (raw === 'deep') {
    onWarn?.(`Legacy 'deep' mode received; mapping to 'paranoid'`)
    return 'paranoid'
  }

  // v0.3: playbook:name@version pattern
  if (raw) {
    const match = PLAYBOOK_PATTERN.exec(raw)
    if (match) {
      const [, name, version] = match
      if (name && version) {
        return raw as `playbook:${string}@${string}`
      }
    } else if (raw.startsWith('playbook:')) {
      onWarn?.(`Invalid playbook mode '${raw}' — expected format: playbook:{name}@{version}, falling back to 'standard'`)
      return 'standard'
    }
  }

  onWarn?.(`Unknown scanMode '${raw}', falling back to 'standard'`)
  return 'standard'
}
