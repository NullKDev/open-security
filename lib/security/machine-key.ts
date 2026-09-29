/**
 * lib/security/machine-key.ts
 *
 * Machine-specific key derivation using PBKDF2-SHA-256.
 * The derived key is used to encrypt/decrypt secrets in the local SQLite store.
 *
 * Key material: `{hostname}:{platform}:{uid}` + optional OBT_KEY_SECRET env var.
 * The same machine identity always produces the same key.
 */
import { pbkdf2Sync } from 'node:crypto'

/**
 * Inputs for machine key derivation.
 */
export interface MachineKeyInputs {
  /** System hostname (e.g. from os.hostname()) */
  hostname: string
  /** Operating system platform (e.g. 'linux' | 'darwin' | 'win32') */
  platform: string
  /** User identifier — numeric UID on Unix, username on Windows */
  uid: string
  /** Optional additional secret (e.g. from OBT_KEY_SECRET env var) */
  secret?: string
}

/**
 * Derive a 32-byte machine-specific key using PBKDF2-SHA-256.
 *
 * The IKM (Input Key Material) is `{hostname}:{platform}:{uid}`.
 * When `secret` is provided it is appended as `:{secret}`.
 * Salt is fixed as the UTF-8 encoding of `open-security-v1`.
 * Iterations: 100,000 (NIST SP 800-132 minimum for interactive use).
 *
 * @param inputs - Machine identity and optional extra entropy
 * @returns 32-byte Uint8Array suitable for AES-256-GCM
 */
export async function deriveMachineKey(inputs: MachineKeyInputs): Promise<Uint8Array> {
  const { hostname, platform, uid, secret } = inputs

  const ikm = secret
    ? `${hostname}:${platform}:${uid}:${secret}`
    : `${hostname}:${platform}:${uid}`

  const salt = Buffer.from('open-security-v1', 'utf-8')
  const keyBuf = pbkdf2Sync(ikm, salt, 100_000, 32, 'sha256')

  return new Uint8Array(keyBuf)
}
