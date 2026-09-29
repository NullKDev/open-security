import path from 'node:path'

export class PathTraversalError extends Error {
  constructor(candidate: string) {
    super(`Path traversal attempt: ${candidate}`)
    this.name = 'PathTraversalError'
  }
}

export function assertUnder(root: string, candidate: string): void {
  const resolved = path.resolve(candidate)
  const resolvedRoot = path.resolve(root)
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new PathTraversalError(candidate)
  }
}
