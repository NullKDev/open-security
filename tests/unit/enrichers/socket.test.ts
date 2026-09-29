/**
 * tests/unit/enrichers/socket.test.ts
 *
 * TDD RED → GREEN: T-020 + T-021 — Socket.dev enricher
 *
 * Covers:
 * - Package with malware alert → socket:malware finding emitted
 * - Missing API key → zero network calls
 * - 429 → exponential backoff retry (mock 429 then 200)
 * - Cache hit skips network
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { scanPackages } from '@/lib/enrichers/socket'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  // Clear env
  delete process.env['OBT_SOCKET_API_KEY']
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env['OBT_SOCKET_API_KEY']
})

function makeSocketResponse(alerts: { type: string }[] = []): object {
  return {
    score: {
      overall: 0.7,
      security: 0.5,
    },
    alerts,
  }
}

describe('scanPackages()', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  describe('API key missing', () => {
    it('makes zero network calls when OBT_SOCKET_API_KEY is not set', async () => {
      const findings = await scanPackages(
        [{ name: 'lodash', version: '4.17.21', ecosystem: 'npm' }],
        db,
      )
      expect(mockFetch).not.toHaveBeenCalled()
      expect(findings).toHaveLength(0)
    })
  })

  describe('with API key', () => {
    beforeEach(() => {
      process.env['OBT_SOCKET_API_KEY'] = 'test-socket-key'
    })

    it('returns socket:malware finding when alert type is malware', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeSocketResponse([{ type: 'malware' }]),
      })

      const findings = await scanPackages(
        [{ name: 'evil-pkg', version: '1.0.0', ecosystem: 'npm' }],
        db,
      )

      expect(findings).toHaveLength(1)
      expect(findings[0]?.tag).toBe('socket:malware')
      expect(findings[0]?.severity).toBe('critical')
    })

    it('emits no findings for a clean package (no alerts)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeSocketResponse([]),
      })

      const findings = await scanPackages(
        [{ name: 'safe-pkg', version: '2.0.0', ecosystem: 'npm' }],
        db,
      )

      expect(findings).toHaveLength(0)
    })

    it('emits multiple findings when multiple alert types are present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          makeSocketResponse([
            { type: 'typosquat' },
            { type: 'obfuscated-code' },
          ]),
      })

      const findings = await scanPackages(
        [{ name: 'suspicious-pkg', version: '1.0.0', ecosystem: 'npm' }],
        db,
      )

      expect(findings).toHaveLength(2)
      const tags = findings.map((f) => f.tag)
      expect(tags).toContain('socket:typosquat')
      expect(tags).toContain('socket:obfuscated-code')
    })

    it('retries on 429 with backoff — resolves after second call', async () => {
      // First call: 429, second call: 200
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSocketResponse([{ type: 'malware' }]),
        })

      // Use fake timers to avoid actual delays in tests
      vi.useFakeTimers()

      const promise = scanPackages(
        [{ name: 'rate-limited-pkg', version: '1.0.0', ecosystem: 'npm' }],
        db,
      )

      // Advance timers past the 1s backoff
      await vi.runAllTimersAsync()

      const findings = await promise
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(findings).toHaveLength(1)

      vi.useRealTimers()
    })

    it('cache hit skips network — second scan does not call fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeSocketResponse([{ type: 'malware' }]),
      })

      await scanPackages(
        [{ name: 'cached-pkg', version: '3.0.0', ecosystem: 'npm' }],
        db,
      )
      await scanPackages(
        [{ name: 'cached-pkg', version: '3.0.0', ecosystem: 'npm' }],
        db,
      )

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('empty package list → zero calls', async () => {
      const findings = await scanPackages([], db)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(findings).toHaveLength(0)
    })
  })
})
