/**
 * Execute a security scan via ACP (Agent Communication Protocol) transport.
 *
 * Thin adapter that delegates the full ACP lifecycle to {@link SessionManager}.
 * Uses `@agentclientprotocol/sdk@0.21.0` for standards-compliant ACP
 * communication. No protocol logic lives here — SessionManager handles:
 * spawn → initialize → newSession → prompt → stream events → complete/cancel.
 *
 * @module acp
 */
import type { ProviderEvent, ScanOpts } from '@/lib/providers/index'
import type { AgentDef } from '@/lib/providers/cli/agents'
import { SessionManager } from './session-manager'

/**
 * Execute a security scan via ACP transport.
 *
 * Creates a {@link SessionManager} and delegates the full scan lifecycle
 * to {@link SessionManager.run}. All protocol logic — spawning, connecting,
 * session creation, prompting, event streaming, cancellation, and process
 * cleanup — is handled by SessionManager.
 *
 * @param def - Agent definition (bin, acpArgs, env, etc.)
 * @param prompt - The security scanning prompt to send
 * @param opts - Scan options including targetPath
 * @yields ProviderEvents as they arrive from the agent
 */
export async function* acpScan(
  def: AgentDef,
  prompt: string,
  opts: ScanOpts,
): AsyncIterable<ProviderEvent> {
  const manager = new SessionManager()
  yield* manager.run(def, prompt, opts)
}
