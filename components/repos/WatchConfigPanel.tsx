"use client"

import { useState } from "react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface WatchConfigPanelProps {
  repoId: string
  initialConfig?: {
    watchEnabled: boolean
    watchInterval: string
    slackWebhookUrl?: string | null
    notifySeverityFloor: string
  }
}

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"] as const
type SeverityFloor = (typeof SEVERITY_OPTIONS)[number]

/**
 * Panel for configuring Watch Mode per-repo settings.
 *
 * Allows enabling/disabling watch mode, setting the cron schedule,
 * Slack webhook URL, and minimum severity floor for notifications.
 * On save, upserts the repo via PUT /api/repos/{repoId}.
 *
 * @param props.repoId - The repo to configure
 * @param props.initialConfig - Current config values (pre-populated from server)
 */
export function WatchConfigPanel({ repoId, initialConfig }: WatchConfigPanelProps) {
  const [watchEnabled, setWatchEnabled] = useState(
    initialConfig?.watchEnabled ?? false,
  )
  const [cronExpression, setCronExpression] = useState(
    initialConfig?.watchInterval ?? "0 */6 * * *",
  )
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(
    initialConfig?.slackWebhookUrl ?? "",
  )
  const [severityFloor, setSeverityFloor] = useState<SeverityFloor>(
    (initialConfig?.notifySeverityFloor as SeverityFloor) ?? "high",
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)

    try {
      const res = await fetch(`/api/repos/${repoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watchEnabled,
          watchInterval: cronExpression,
          slackWebhookUrlRef: slackWebhookUrl || null,
          notifySeverityFloor: severityFloor,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-fg">Watch Mode</h3>

      {/* Enable/disable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="watch-enabled" className="text-sm">
            Enable Watch Mode
          </Label>
          <p className="mt-0.5 text-xs text-fg/50">
            Automatically scan when new commits are detected
          </p>
        </div>
        <Switch
          id="watch-enabled"
          checked={watchEnabled}
          onCheckedChange={setWatchEnabled}
        />
      </div>

      {/* Cron expression */}
      <div className="space-y-1">
        <Label htmlFor="cron-expr" className="text-xs text-fg/70">
          Check schedule (cron)
        </Label>
        <Input
          id="cron-expr"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          placeholder="0 */6 * * *"
          className="font-mono text-xs"
          disabled={!watchEnabled}
        />
        <p className="text-xs text-fg/40">Default: every 6 hours</p>
      </div>

      {/* Slack webhook URL */}
      <div className="space-y-1">
        <Label htmlFor="slack-url" className="text-xs text-fg/70">
          Slack webhook URL
        </Label>
        <Input
          id="slack-url"
          type="url"
          value={slackWebhookUrl}
          onChange={(e) => setSlackWebhookUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className="text-xs"
          disabled={!watchEnabled}
        />
      </div>

      {/* Severity floor */}
      <div className="space-y-1">
        <Label className="text-xs text-fg/70">Minimum severity to notify</Label>
        <div className="flex gap-1.5">
          {SEVERITY_OPTIONS.map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setSeverityFloor(sev)}
              disabled={!watchEnabled}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                severityFloor === sev
                  ? "bg-accent text-white"
                  : "border border-border bg-transparent text-fg/60 hover:text-fg"
              } disabled:pointer-events-none disabled:opacity-40`}
            >
              {sev}
            </button>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : saved ? "Saved" : "Save"}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}
