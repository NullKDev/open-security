/**
 * /settings/webhook — Standalone webhook setup wizard page.
 *
 * Displays the smee channel URL and instructions for configuring
 * GitHub webhooks to route to open-security.
 */
import { WebhookWizard } from "@/components/repos/WebhookWizard"
import { getWebhookSecret } from "@/lib/repos/github-settings.repo"

export const dynamic = "force-dynamic"

async function fetchSmeeUrl(): Promise<string | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/config`, { cache: "no-store" }) // api/config
    if (!res.ok) return null
    const body = await res.json()
    // smeeChannelUrl is not in public config by default — fall back to env
    return (
      (body.data as Record<string, unknown>)?.webhookProxyUrl as string | undefined
    ) ?? process.env.SMEE_CHANNEL_URL ?? null
  } catch {
    return process.env.SMEE_CHANNEL_URL ?? null
  }
}

export default async function WebhookSettingsPage() {
  const smeeUrl = await fetchSmeeUrl()
  const secretConfigured = getWebhookSecret() !== null

  return (
    <div className="flex-1 max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">Webhook Setup</h1>
        <p className="text-sm text-fg/50">
          Connect GitHub to open-security for automatic diff scans on PRs.
        </p>
      </div>

      <WebhookWizard
        smeeChannelUrl={smeeUrl ?? undefined}
        secretConfigured={secretConfigured}
      />
    </div>
  )
}
