import { describe, it, expect } from 'vitest'
import { assertUnder, PathTraversalError } from '@/lib/security/path-guard'

describe('assertUnder', () => {
  const root = '/safe/root'

  it('throws on path traversal (relative escape)', () => {
    expect(() => assertUnder(root, '../escape')).toThrow(PathTraversalError)
  })

  it('throws on absolute path outside root', () => {
    expect(() => assertUnder(root, '/etc/passwd')).toThrow(PathTraversalError)
  })

  it('does NOT throw on valid path under root', () => {
    expect(() => assertUnder(root, '/safe/root/sub/file.txt')).not.toThrow()
  })

  it('throws on prefix trick (root-sibling)', () => {
    // /safe/root-sibling starts with /safe/root but is NOT under it
    expect(() => assertUnder(root, '/safe/root-sibling')).toThrow(PathTraversalError)
  })
})
