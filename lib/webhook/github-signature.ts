import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Validate a GitHub webhook HMAC-SHA256 signature.
 *
 * GitHub signs every webhook delivery with `X-Hub-Signature-256: sha256=<hex>`.
 * This function verifies the signature using a constant-time comparison to
 * prevent timing attacks.
 *
 * @param payload - Raw request body as a Buffer
 * @param signature - Value of the `X-Hub-Signature-256` header (e.g. "sha256=abc...")
 * @param secret - Webhook secret configured for the repo
 * @returns true if the signature is valid, false otherwise
 */
export function validateGithubSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  // Guard: reject null/undefined/empty signatures before any computation
  if (!signature || typeof signature !== 'string') return false
  if (!signature.startsWith('sha256=')) return false

  const expectedHex = signature.slice('sha256='.length)

  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  const actualHex = hmac.digest('hex')

  // Pad to same length to allow timingSafeEqual (it requires equal-length buffers)
  const actualBuf = Buffer.from(actualHex, 'hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')

  // If lengths differ the signature is invalid — but we must not short-circuit
  // on length alone (that would be a timing oracle). Instead we compare against
  // the actual HMAC, which is always 32 bytes. If expectedBuf is not 32 bytes
  // it cannot match, so we return false after the constant-time check.
  if (expectedBuf.length !== actualBuf.length) return false

  try {
    return timingSafeEqual(actualBuf, expectedBuf)
  } catch {
    return false
  }
}
