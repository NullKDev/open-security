/**
 * tests/unit/security/machine-key.test.ts
 *
 * TDD RED → GREEN: T-003 + T-004 — machine-key derivation
 *
 * Covers:
 * - deriveMachineKey() returns a 32-byte Uint8Array
 * - Same inputs produce the same key (deterministic)
 * - Different hostname produces a different key
 */
import { describe, it, expect } from 'vitest'
import { deriveMachineKey } from '@/lib/security/machine-key'

describe('deriveMachineKey', () => {
  it('returns a Uint8Array of exactly 32 bytes', async () => {
    const key = await deriveMachineKey({
      hostname: 'test-host',
      platform: 'linux',
      uid: 'uid-1000',
    })
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.byteLength).toBe(32)
  })

  it('is deterministic — same inputs produce identical key material', async () => {
    const input = { hostname: 'my-machine', platform: 'darwin', uid: 'uid-501' }
    const key1 = await deriveMachineKey(input)
    const key2 = await deriveMachineKey(input)
    expect(key1).toEqual(key2)
  })

  it('different hostname produces different key', async () => {
    const key1 = await deriveMachineKey({ hostname: 'machine-a', platform: 'linux', uid: 'uid-1000' })
    const key2 = await deriveMachineKey({ hostname: 'machine-b', platform: 'linux', uid: 'uid-1000' })
    expect(key1).not.toEqual(key2)
  })

  it('different platform produces different key', async () => {
    const key1 = await deriveMachineKey({ hostname: 'host', platform: 'linux', uid: 'uid-1000' })
    const key2 = await deriveMachineKey({ hostname: 'host', platform: 'darwin', uid: 'uid-1000' })
    expect(key1).not.toEqual(key2)
  })

  it('optional secret salt changes the derived key', async () => {
    const base = { hostname: 'host', platform: 'linux', uid: 'uid-1000' }
    const key1 = await deriveMachineKey(base)
    const key2 = await deriveMachineKey({ ...base, secret: 'extra-entropy' })
    expect(key1).not.toEqual(key2)
  })
})
