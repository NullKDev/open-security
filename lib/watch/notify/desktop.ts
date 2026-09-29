/**
 * lib/watch/notify/desktop.ts
 *
 * Desktop OS notification sender.
 *
 * Tries `terminal-notifier` (macOS) then `notify-send` (Linux).
 * Falls back gracefully if neither is available.
 *
 * `node-notifier` is not in the dependency list — we use direct child_process
 * invocation to avoid the npm dependency. Desktop notifications are optional/
 * best-effort; failure never blocks watch scan completion.
 */

import * as cp from 'node:child_process'

interface SendDesktopOpts {
  /** Notification title */
  title: string
  /** Notification body text */
  message: string
}

/**
 * Try to send a desktop OS notification via `terminal-notifier` (macOS).
 * Returns true if the binary was found and invoked, false otherwise.
 */
function tryTerminalNotifier(title: string, message: string): boolean {
  try {
    cp.execFileSync('terminal-notifier', ['-title', title, '-message', message], {
      timeout: 3000,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Try to send a desktop OS notification via `notify-send` (Linux/freedesktop).
 * Returns true if the binary was found and invoked, false otherwise.
 */
function tryNotifySend(title: string, message: string): boolean {
  try {
    cp.execFileSync('notify-send', [title, message], {
      timeout: 3000,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Send a desktop OS notification. Tries `terminal-notifier` (macOS) then
 * `notify-send` (Linux). Silently no-ops if neither tool is installed.
 *
 * @param opts.title - Notification title
 * @param opts.message - Notification body
 */
export async function sendDesktopNotification(opts: SendDesktopOpts): Promise<void> {
  const { title, message } = opts
  // Both calls are fire-and-forget and catch their own errors
  if (!tryTerminalNotifier(title, message)) {
    tryNotifySend(title, message)
  }
}
