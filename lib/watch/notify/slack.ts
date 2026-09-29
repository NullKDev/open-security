/**
 * lib/watch/notify/slack.ts
 *
 * Slack webhook notification sender.
 *
 * Uses native fetch (no Slack SDK dependency).
 * Never throws — errors are silently swallowed to avoid blocking scan completion.
 */

interface SendSlackOpts {
  /** Slack incoming webhook URL */
  webhookUrl: string
  /** Plain text message body */
  message: string
}

/**
 * POST a notification to a Slack incoming webhook.
 *
 * Gracefully handles network errors and non-ok responses — never throws.
 *
 * @param opts.webhookUrl - Slack webhook URL
 * @param opts.message - Message text to send
 */
export async function sendSlackNotification(opts: SendSlackOpts): Promise<void> {
  const { webhookUrl, message } = opts
  try {
    await fetch(webhookUrl, { // user-webhook-fetch
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
    // Non-ok responses are silently ignored — Slack delivery is best-effort
  } catch {
    // Network error — fail gracefully, never throw
  }
}
