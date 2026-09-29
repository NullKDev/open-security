/**
 * lib/enrichers/socket-alert-mapper.ts
 *
 * Maps Socket.dev alert types to internal finding tags and severity levels.
 * This is a pure mapping table — no I/O, no side effects.
 */

export type SocketSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface SocketAlertMapping {
  tag: string
  severity: SocketSeverity
}

/** Default mapping for unknown / unrecognised alert types. */
export const SOCKET_DEFAULT_MAPPING: SocketAlertMapping = {
  tag: 'socket:unknown',
  severity: 'medium',
}

const ALERT_MAP: Record<string, SocketAlertMapping> = {
  malware: { tag: 'socket:malware', severity: 'critical' },
  protestware: { tag: 'socket:protestware', severity: 'high' },
  typosquat: { tag: 'socket:typosquat', severity: 'high' },
  'suspicious-files': { tag: 'socket:suspicious-files', severity: 'medium' },
  'obfuscated-code': { tag: 'socket:obfuscated-code', severity: 'medium' },
  'hidden-payload': { tag: 'socket:hidden-payload', severity: 'high' },
  'network-access': { tag: 'socket:network-access', severity: 'low' },
  'filesystem-access': { tag: 'socket:filesystem-access', severity: 'low' },
  'license-change': { tag: 'socket:license-change', severity: 'info' },
}

/**
 * Map a Socket.dev alert type to an internal finding tag and severity.
 *
 * Returns the default mapping (`socket:unknown`, severity `medium`)
 * for any unrecognised alert type.
 *
 * @param alertType - The Socket.dev alert type string (e.g. 'malware')
 * @returns Mapping object with `tag` and `severity`
 */
export function mapSocketAlert(alertType: string): SocketAlertMapping {
  return ALERT_MAP[alertType] ?? SOCKET_DEFAULT_MAPPING
}
