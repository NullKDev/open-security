import { spawn, type ChildProcess } from 'node:child_process'
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
}

/**
 * Spawn a CLI provider as a child process with array-form arguments.
 *
 * IMPORTANT: argv must be an array of strings — NEVER pass a shell string.
 * This prevents shell injection and is enforced by the type system.
 *
 * Stdout and stderr are exposed as async iterables for consumption by parsers.
 * When `opts.stdinPrompt` is provided, it is written to stdin and stdin is closed.
 *
 * Error handling: if the binary cannot be spawned (ENOENT, EACCES, etc.), the
 * error is caught internally. stdout/stderr are destroyed cleanly (without
 * emitting stream errors), the `exited` promise resolves normally, and a
 * `console.warn` is emitted. Parsers will receive an empty stream — the caller
 * must handle the case of zero output from a failed spawn.
 */
export function spawnProvider(
  bin: string,
  argv: string[],
  opts?: {
    cwd?: string
    env?: Record<string, string | undefined>
    timeout?: number
    /** When set, pipe this string to the child's stdin then close it. */
    stdinPrompt?: string
    /** When true, open stdin as a pipe without writing to it (for ACP/JSON-RPC transports). */
    pipeStdin?: boolean
  },
): SpawnResult {
  const stdoutPass = new PassThrough()
  const stderrPass = new PassThrough()

  const stdinMode = (opts?.stdinPrompt !== undefined || opts?.pipeStdin) ? 'pipe' : 'ignore'

  const child = spawn(bin, argv, {
    cwd: opts?.cwd,
    env: { ...process.env, ...filterEnv(opts?.env) },
    stdio: [stdinMode, 'pipe', 'pipe'],
    timeout: opts?.timeout,
  })

  if (opts?.stdinPrompt !== undefined && child.stdin) {
    child.stdin.on('error', () => { /* swallow EPIPE if process exits early */ })
    child.stdin.end(opts.stdinPrompt, 'utf8')
  }

  child.stdout?.pipe(stdoutPass)
  child.stderr?.pipe(stderrPass)

  let errorEmitted = false

  child.on('error', (_err) => {
    errorEmitted = true
    // Log a clean warning instead of crashing with uncaughtException.
    console.warn(`[spawn] ${bin} failed to start: ${(_err as NodeJS.ErrnoException).code ?? 'unknown error'}`)
    // Attach error listeners BEFORE destroying to prevent uncaughtException.
    stdoutPass.on('error', () => {})
    stderrPass.on('error', () => {})
    stdoutPass.destroy()
    stderrPass.destroy()
  })

  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      child.on('close', (code, signal) => {
        resolve({ code: signal ? null : code, signal })
      })
      // error is handled above — destroy streams, then close fires naturally
    },
  )
  // Suppress unhandled rejection in case no one awaits exited.
  // The error is already communicated via stream destruction above.
  exited.catch(() => {})

  return {
    process: child,
    stdout: streamToAsyncIterable(stdoutPass),
    stderr: streamToAsyncIterable(stderrPass),
    exited,
  }
}

/** Convert a Readable stream to an AsyncIterable of UTF-8 strings */
async function* streamToAsyncIterable(
  stream: NodeJS.ReadableStream,
): AsyncIterable<string> {
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      yield chunk.toString('utf-8')
    } else {
      yield String(chunk)
    }
  }
}

/** Strip undefined values from env object */
function filterEnv(
  env?: Record<string, string | undefined>,
): Record<string, string> {
  if (!env) return {}
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      filtered[key] = value
    }
  }
  return filtered
}
