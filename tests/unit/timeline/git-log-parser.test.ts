/**
 * tests/unit/timeline/git-log-parser.test.ts
 *
 * TDD: T-014/T-015 — git-log-parser
 * Tests for parsing git log output to detect secret introduction/removal commits.
 *
 * Tests the pure parseOutput() function directly (avoids complex spawn mocking).
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { parseOutput } from '@/lib/timeline/git-log-parser'

// Realistic git log -p output for a secret introduction commit
const INTRODUCE_LOG = `abc123def456|Alice Smith|alice@example.com|2024-01-15T10:30:00+00:00
diff --git a/config/.env b/config/.env
--- /dev/null
+++ b/config/.env
@@ -0,0 +1,3 @@
+SECRET_KEY=mysecretvalue
+DB_PASS=password123
`

// Realistic output for a removal commit
const REMOVE_LOG = `def789abc012|Bob Jones|bob@example.com|2024-02-20T14:00:00+00:00
diff --git a/config/.env b/config/.env
--- a/config/.env
+++ b/config/.env
@@ -1,3 +1,2 @@
-SECRET_KEY=mysecretvalue
 DB_PASS=password123
`

// Both commits together
const COMBINED_LOG = INTRODUCE_LOG + '\n' + REMOVE_LOG

describe('parseOutput()', () => {
  describe('parsing commit metadata', () => {
    it('parses hash, author, email, date from a commit header', () => {
      const commits = parseOutput(INTRODUCE_LOG)
      expect(commits).toHaveLength(1)
      const commit = commits[0]
      expect(commit.hash).toBe('abc123def456')
      expect(commit.author).toBe('Alice Smith')
      expect(commit.email).toBe('alice@example.com')
      expect(commit.date).toBe('2024-01-15T10:30:00+00:00')
    })

    it('detects introduce action when diff has + lines', () => {
      const commits = parseOutput(INTRODUCE_LOG)
      expect(commits[0].action).toBe('introduce')
    })

    it('detects remove action when diff has - lines only', () => {
      const commits = parseOutput(REMOVE_LOG)
      expect(commits[0].action).toBe('remove')
    })

    it('parses multiple commits from combined output in order', () => {
      const commits = parseOutput(COMBINED_LOG)
      expect(commits).toHaveLength(2)
      expect(commits[0].hash).toBe('abc123def456')
      expect(commits[0].action).toBe('introduce')
      expect(commits[1].hash).toBe('def789abc012')
      expect(commits[1].action).toBe('remove')
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      const commits = parseOutput('')
      expect(commits).toHaveLength(0)
    })

    it('ignores +++ and --- lines (file headers, not diff content)', () => {
      // A commit that only has +++ and --- but no actual additions/deletions
      // should still be parsed as introduce (default)
      const headerOnlyLog = `aabbccdd1122|Dev User|dev@example.com|2024-03-01T00:00:00+00:00
diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
`
      const commits = parseOutput(headerOnlyLog)
      expect(commits).toHaveLength(1)
      // No +/- lines found: defaults to introduce
      expect(commits[0].action).toBe('introduce')
    })
  })
})
