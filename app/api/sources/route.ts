import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { assertUnder } from '@/lib/security/path-guard'
import { ValidateSourceSchema } from '@/lib/api/schemas'

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = ValidateSourceSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { sourceType, sourceRef } = parsed.data

  // For local sources, validate path exists and is under workspace
  if (sourceType === 'local') {
    try {
      const resolved = resolve(sourceRef)
      assertUnder(process.cwd(), resolved)
      if (!existsSync(resolved)) {
        return ok({ valid: false, reason: `Path does not exist: ${sourceRef}` })
      }
    } catch (err) {
      return ok({ valid: false, reason: `Invalid path: ${(err as Error).message}` })
    }
  }

  // For ZIP sources, check file exists
  if (sourceType === 'zip') {
    const resolved = resolve(sourceRef)
    if (!existsSync(resolved)) {
      return ok({ valid: false, reason: `File does not exist: ${sourceRef}` })
    }
  }

  // For remote sources (github, gitlab), validate URL and check git access
  if (sourceType === 'github' || sourceType === 'gitlab') {
    try {
      new URL(sourceRef)
    } catch {
      return ok({ valid: false, reason: `Invalid URL: ${sourceRef}` })
    }

    // Check actual repo access using git ls-remote
    // This uses the user's local git credentials (SSH keys, credential helper)
    try {
      execSync(`git ls-remote --heads "${sourceRef}"`, {
        timeout: 10_000,
        stdio: 'pipe',
      })
      // Success — we have access
    } catch (gitErr: unknown) {
      const message = gitErr instanceof Error
        ? (gitErr as Error & { stderr?: Buffer }).stderr?.toString() || gitErr.message
        : String(gitErr)

      // Detect auth-related failures
      const lowerMsg = message.toLowerCase()
      const isAuthError =
        lowerMsg.includes('permission denied') ||
        lowerMsg.includes('authentication failed') ||
        lowerMsg.includes('could not read from remote') ||
        lowerMsg.includes('repository not found') ||
        lowerMsg.includes('access denied') ||
        lowerMsg.includes('fatal: could not read') ||
        lowerMsg.includes('exit code 128')

      if (isAuthError) {
        return ok({
          valid: false,
          reason: `No access to this repository. It may be private or you may not have the right credentials.`,
          noAccess: true,
          suggestion: "If you have a local copy, use the folder option below instead."
        })
      }

      // Other git errors → fail open
      return ok({ valid: false, reason: `Could not verify repository: ${message.slice(0, 200)}` })
    }
  }

  return ok({ valid: true })
}
