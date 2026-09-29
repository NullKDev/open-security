/**
 * tests/unit/watch/notify.test.ts
 *
 * TDD: T-H08 — desktop + Slack notifiers
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { sendSlackNotification, sendDesktopNotification, sendNotification } =
  await import('@/lib/watch/notify/index')

describe('sendSlackNotification', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.resetAllMocks())

  it('exports sendSlackNotification as a function', () => {
    expect(typeof sendSlackNotification).toBe('function')
  })

  it('POSTs to the webhook URL with the message', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })

    await sendSlackNotification({
      webhookUrl: 'https://hooks.slack.com/services/test',
      message: 'Found 3 new security findings',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('3 new security findings'),
      }),
    )
  })

  it('does not throw on non-ok response (graceful failure)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(
      sendSlackNotification({
        webhookUrl: 'https://hooks.slack.com/services/test',
        message: 'Alert',
      }),
    ).resolves.not.toThrow()
  })

  it('does not throw when fetch rejects (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'))

    await expect(
      sendSlackNotification({
        webhookUrl: 'https://hooks.slack.com/services/test',
        message: 'Alert',
      }),
    ).resolves.not.toThrow()
  })
})

describe('sendDesktopNotification', () => {
  it('exports sendDesktopNotification as a function', () => {
    expect(typeof sendDesktopNotification).toBe('function')
  })

  it('does not throw even when notification tool is unavailable', async () => {
    await expect(
      sendDesktopNotification({
        title: 'open-security',
        message: '3 new findings in my-repo',
      }),
    ).resolves.not.toThrow()
  })
})

describe('sendNotification', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.resetAllMocks())

  it('exports sendNotification as a function', () => {
    expect(typeof sendNotification).toBe('function')
  })

  it('sends Slack notification when channel is slack', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })

    await sendNotification({
      channel: 'slack',
      repoName: 'my-repo',
      findingCount: 2,
      slackWebhookUrl: 'https://hooks.slack.com/services/test',
    })

    expect(mockFetch).toHaveBeenCalled()
  })

  it('sends desktop notification when channel is desktop', async () => {
    // Desktop notification calls a system binary — just verify it doesn't throw
    await expect(
      sendNotification({
        channel: 'desktop',
        repoName: 'my-repo',
        findingCount: 1,
      }),
    ).resolves.not.toThrow()
  })

  it('does not send Slack when no webhookUrl provided', async () => {
    await sendNotification({
      channel: 'slack',
      repoName: 'my-repo',
      findingCount: 1,
      slackWebhookUrl: undefined,
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
