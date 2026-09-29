/**
 * spawn-shell.ts — Login-shell spawner for ACP agent binaries.
 *
 * On macOS/Linux, agents are spawned via the user's login shell so that PATH,
 * nvm, rbenv, and other shell initialisation is available.
 *
 * Teardown: SIGTERM → 5 s grace period → SIGKILL to prevent zombie processes.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { PassThrough } from 'node:stream'

export interface SpawnResult {
  /** The underlying child process */
  process: ChildProcess
  /** Async iterable of stdout chunks (UTF-8 decoded) */
  stdout: AsyncIterable<string>
  /** Async iterable of stderr chunks (UTF-8 decoded) */
  stderr: AsyncIterable<string>
  /** Promise that resolves when the process exits */
  exited: Promise<{ code: number | null; signal: string | null }>
  /** Kill the process: SIGTERM first, then SIGKILL after 5 s if still alive */
  kill: () => void
}

interface ShellSpec {
  /** Flag to suppress rc/config files (null = not supported by this shell). */
  noRcFlag: string | null
  /** Whether the shell accepts the -l (login) flag. */
  loginFlag: boolean
}

/**
 * Registry of known shells and their spawn-time capabilities.
 * Add a new entry here to support an additional shell — no other changes needed.
 */
const SHELL_REGISTRY: Record<string, ShellSpec> = {
  zsh:  { noRcFlag: '--no-rcs',    loginFlag: true  },
  bash: { noRcFlag: '--norc',      loginFlag: true  },
  ksh:  { noRcFlag: '--no-rcs',    loginFlag: true  },
  fish: { noRcFlag: '--no-config', loginFlag: false },
  sh:   { noRcFlag: null,          loginFlag: false },
  dash: { noRcFlag: null,          loginFlag: false },
}

const FALLBACK_SPEC: ShellSpec = { noRcFlag: null, loginFlag: false }

/** Look up shell capabilities by basename (e.g. "fish", "zsh"). */
export function getShellSpec(shellName: string): ShellSpec {
  return SHELL_REGISTRY[shellName] ?? FALLBACK_SPEC
}

/**
 * Resolve the user's login shell and its spawn capabilities.
 *
 * Known shells are looked up in SHELL_REGISTRY. Unknown / non-POSIX shells
 * (csh, tcsh, …) fall back to bash or /bin/sh.
 *
 * @returns The resolved shell path and its ShellSpec.
 */
export function resolveUnixShell(): { shell: string; spec: ShellSpec } {
  const userShell = process.env.SHELL

  if (userShell) {
    const base = userShell.split('/').pop() ?? ''
    if (base in SHELL_REGISTRY) {
      return { shell: userShell, spec: SHELL_REGISTRY[base] }
    }
    // Non-POSIX shells (csh, tcsh, etc.) — fall through to probed fallback
  }

  // $SHELL not set or not in registry — probe for common shells
  if (existsSync('/bin/bash')) {
    return { shell: '/bin/bash', spec: SHELL_REGISTRY['bash'] }
  }
  if (existsSync('/usr/bin/bash')) {
    return { shell: '/usr/bin/bash', spec: SHELL_REGISTRY['bash'] }
  }
  return { shell: '/bin/sh', spec: FALLBACK_SPEC }
}

/**
 * Escape a single argument for use in a POSIX shell command string.
 *
 * Wraps the argument in single quotes and escapes any embedded single quotes
 * using the standard `'\''` sequence.
 */
function shellEscapeArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Build a POSIX shell command string from a binary name and arguments.
 */
function shellEscape(argv: string[]): string {
  return argv.map(shellEscapeArg).join(' ')
}

/**
 * Spawn an agent binary via the user's login shell.
 *
 * - macOS / Linux: uses `$SHELL ?? '/bin/zsh'` with `['-l', '-c', cmd]`
 * - Windows: direct spawn with `{ shell: true }` (no login-shell wrapping)
 *
 * The returned `kill()` method sends SIGTERM and schedules a SIGKILL after
 * 5 000 ms if the process hasn't exited by then.
 */
export function spawnLoginShell(
  bin: string,
  args: string[],
  opts: {
    cwd: string
    env?: Record<string, string | undefined>
    onStderrLine?: (line: string) => void
  },
): SpawnResult {
  const stdoutPass = new PassThrough()
  const stderrPass = new PassThrough()

  let child: ChildProcess

  if (process.platform === 'win32') {
    // Windows: direct spawn with shell:true so PATH resolution still works
    child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...filterEnv(opts.env) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    })
  } else {
    const { shell, spec } = resolveUnixShell()
    const cmd = shellEscape([bin, ...args])
    // Suppress shell rc/config files to prevent banner output contaminating
    // the ACP ndjson stream. Profile (-l) is still sourced for PATH, nvm, etc.
    const { noRcFlag, loginFlag } = spec

    const shellArgs = loginFlag
      ? (noRcFlag ? [noRcFlag, '-l', '-c', cmd] : ['-l', '-c', cmd])
      : (noRcFlag ? [noRcFlag, '-c', cmd] : ['-c', cmd])

    child = spawn(shell, shellArgs, {
      cwd: opts.cwd,
      env: { ...process.env, ...filterEnv(opts.env) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  child.stdout?.pipe(stdoutPass)
  child.stderr?.pipe(stderrPass)

  // Forward stderr lines to the optional callback
  if (opts.onStderrLine) {
    const callback = opts.onStderrLine
    let stderrBuf = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8')
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) callback(line)
    })
    child.stderr?.on('end', () => {
      if (stderrBuf) callback(stderrBuf)
    })
  }

  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code: signal ? null : code, signal })
    })
  })
  exited.catch(() => {})

  let killTimer: ReturnType<typeof setTimeout> | null = null

  function kill(): void {
    child.kill('SIGTERM')
    killTimer = setTimeout(() => {
      child.kill('SIGKILL')
    }, 5000)

    // Cancel the SIGKILL timer if the process exits before it fires
    child.once('close', () => {
      if (killTimer !== null) {
        clearTimeout(killTimer)
        killTimer = null
      }
    })
  }

  return {
    process: child,
    stdout: streamToAsyncIterable(stdoutPass),
    stderr: streamToAsyncIterable(stderrPass),
    exited,
    kill,
  }
}

/** Convert a Readable stream to an AsyncIterable of UTF-8 strings */
async function* streamToAsyncIterable(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      yield chunk.toString('utf-8')
    } else {
      yield String(chunk)
    }
  }
}

/** Strip undefined values from an env map */
function filterEnv(env?: Record<string, string | undefined>): Record<string, string> {
  if (!env) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value
  }
  return result
}
