/**
 * lib/watch/notify/index.ts
 *
 * Unified notification dispatcher for Watch Mode.
 *
 * Re-exports channel-specific senders and provides a `sendNotification`
 * function that dispatches to the correct channel based on config.
 */

export { sendSlackNotification } from './slack'
export { sendDesktopNotification } from './desktop'

interface SendNotificationOpts {
  /** Target channel: 'slack' | 'desktop' */
  channel: string
  /** Human-readable repo name for the notification message */
  repoName: string
  /** Number of net-new findings found */
  findingCount: number
  /** Slack webhook URL (required when channel = 'slack') */
  slackWebhookUrl?: string
}

/**
 * Send a notification to the specified channel.
 *
 * - For `slack`: POST to `slackWebhookUrl`. No-ops if URL is not provided.
 * - For `desktop`: invoke `terminal-notifier` or `notify-send` (best-effort).
 *
 * Never throws — both channels handle their own errors gracefully.
 *
 * @param opts.channel - Notification channel ('slack' or 'desktop')
 * @param opts.repoName - Repository name shown in the message
 * @param opts.findingCount - Number of new findings to report
 * @param opts.slackWebhookUrl - Slack webhook URL (slack channel only)
 */
export async function sendNotification(opts: SendNotificationOpts): Promise<void> {
  const { channel, repoName, findingCount, slackWebhookUrl } = opts

  const message = `open-security: ${findingCount} new finding${findingCount === 1 ? '' : 's'} in ${repoName}`

  if (channel === 'slack') {
    if (!slackWebhookUrl) return
    const { sendSlackNotification } = await import('./slack')
    await sendSlackNotification({ webhookUrl: slackWebhookUrl, message })
    return
  }

  if (channel === 'desktop') {
    const { sendDesktopNotification } = await import('./desktop')
    await sendDesktopNotification({ title: 'open-security', message })
    return
  }

  // Unknown channel — silently no-op
}
