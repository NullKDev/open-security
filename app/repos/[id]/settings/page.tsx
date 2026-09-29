/**
 * /repos/[id]/settings — Watch Mode and webhook configuration for a repo.
 */
import { WatchConfigPanel } from "@/components/repos/WatchConfigPanel"
import { WebhookWizard } from "@/components/repos/WebhookWizard"

export const dynamic = "force-dynamic"

interface RepoDTO {
  id: string
  name: string
  localPath: string
  defaultBranch: string
  watchEnabled: boolean
  watchInterval: string
  notifySeverityFloor: string
  slackWebhookUrlRef: string | null
  webhookProxyUrl: string | null
}

async function fetchRepo(id: string): Promise<RepoDTO | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/repos/${id}`, { cache: "no-store" }) // api/repos
    if (!res.ok) return null
    const body = await res.json()
    return body.data as RepoDTO
  } catch {
    return null
  }
}

export default async function RepoSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const repo = await fetchRepo(id)

  if (!repo) {
    return (
      <div className="p-6">
        <p className="text-sm text-fg/50">Repository not found.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-8 p-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">{repo.name}</h1>
        <p className="text-xs font-mono text-fg/40">{repo.localPath}</p>
      </div>

      {/* Watch Mode config */}
      <WatchConfigPanel
        repoId={repo.id}
        initialConfig={{
          watchEnabled: repo.watchEnabled,
          watchInterval: repo.watchInterval,
          slackWebhookUrl: repo.slackWebhookUrlRef,
          notifySeverityFloor: repo.notifySeverityFloor,
        }}
      />

      {/* Webhook wizard */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-4 text-sm font-semibold text-fg">Webhook</h3>
        <WebhookWizard smeeChannelUrl={repo.webhookProxyUrl ?? undefined} />
      </div>
    </div>
  )
}
