// ─── Runtime secret registry ──────────────────────────────────────────────────

/** Set of plaintext secret values registered at runtime (e.g. from secret-store). */
const registeredSecrets = new Set<string>()

/**
 * Register a runtime secret value that should be redacted from all output.
 * Called after decrypting a credential from the secret-store.
 *
 * @param value - The plaintext secret to register for redaction
 */
export function registerSecret(value: string): void {
  if (value.length > 0) {
    registeredSecrets.add(value)
  }
}

/**
 * Clear all registered runtime secrets (used in tests).
 *
 * @internal
 */
export function __clearRegisteredSecrets(): void {
  registeredSecrets.clear()
}

// ─── Static patterns ──────────────────────────────────────────────────────────

const PATTERNS: Array<[RegExp, string]> = [
  // Anthropic keys: sk-ant-... (before generic Bearer to avoid double-match)
  [/sk-ant-[A-Za-z0-9\-_]{32,}/g, '[REDACTED]'],
  // OpenAI keys: sk- followed by 48 alphanum chars
  [/sk-[A-Za-z0-9]{48}/g, '[REDACTED]'],
  // GitHub PAT (new format): github_pat_...
  [/github_pat_[A-Za-z0-9_]{82}/g, '[REDACTED]'],
  // GitHub PAT (classic): ghp_...
  [/ghp_[A-Za-z0-9]{36}/g, '[REDACTED]'],
  // AWS Access Key ID
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED]'],
  // Bearer tokens (catches remaining tokens not matched above)
  [/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/g, 'Bearer [REDACTED]'],
  // Generic password= in query strings / form data
  [/(password=)[^\s&]+/gi, '$1[REDACTED]'],
  // Generic api_key= / apikey= / api-key=
  [/(api[_-]?key[=:\s]+)[A-Za-z0-9\-_.]{20,}/gi, '$1[REDACTED]'],
]

/**
 * Redact known secret patterns and any registered runtime secrets from a string.
 *
 * Applies static regex patterns first, then replaces any registered secret
 * values verbatim with `[REDACTED]`. Safe to call on JSON-serializable payloads.
 *
 * @param input - The string to redact
 * @returns The redacted string with sensitive values replaced
 */
export function redact(input: string): string {
  // Apply static patterns
  let result = PATTERNS.reduce((acc, [pattern, replacement]) => {
    return acc.replace(pattern, replacement)
  }, input)

  // Apply runtime-registered secrets (exact string match)
  for (const secret of registeredSecrets) {
    if (result.includes(secret)) {
      result = result.split(secret).join('[REDACTED]')
    }
  }

  return result
}
