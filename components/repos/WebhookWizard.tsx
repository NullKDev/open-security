"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface WebhookWizardProps {
  /** Smee channel URL from settings (e.g. https://smee.io/abc123) */
  smeeChannelUrl?: string
  /** Whether a webhook secret is already stored in the DB */
  secretConfigured?: boolean
}

/**
 * Webhook setup wizard for connecting GitHub PR events to open-security.
 *
 * Shows the smee.io relay URL, copy button, step-by-step instructions
 * for pasting into GitHub webhook settings, and a test button.
 * Includes a secret input field that stores the value via
 * PUT /api/settings/webhook-secret (encrypted at rest).
 *
 * @param props.smeeChannelUrl - The smee channel URL to display
 * @param props.secretConfigured - Whether a secret is already stored in the DB
 */
export function WebhookWizard({ smeeChannelUrl, secretConfigured = false }: WebhookWizardProps) {
  const [copied, setCopied] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null)

  const [secret, setSecret] = useState("")
  const [savingSecret, setSavingSecret] = useState(false)
  const [secretSaved, setSecretSaved] = useState(secretConfigured)
  const [secretError, setSecretError] = useState<string | null>(null)

  const displayUrl = smeeChannelUrl ?? "Not configured — start the tunnel with: bun run tunnel"

  async function handleCopy() {
    if (!smeeChannelUrl) return
    try {
      await navigator.clipboard.writeText(smeeChannelUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may not be available in all contexts
    }
  }

  async function handleSaveSecret() {
    if (!secret.trim()) return
    setSavingSecret(true)
    setSecretError(null)

    try {
      const res = await fetch("/api/settings/webhook-secret", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret.trim() }),
      })

      if (res.ok) {
        setSecretSaved(true)
        setSecret("")
      } else {
        const data = (await res.json()) as { error?: { message?: string } }
        setSecretError(data?.error?.message ?? "Failed to save secret")
      }
    } catch {
      setSecretError("Network error — could not save secret")
    } finally {
      setSavingSecret(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)

    try {
      const res = await fetch("/api/webhooks/github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "ping",
          "X-GitHub-Delivery": `test-${Date.now()}`,
          "X-Hub-Signature-256": "sha256=invalid", // Will get 401 — just checks route is live
        },
        body: JSON.stringify({ zen: "test", hook_id: 0 }),
      })

      // 401 means the route is live (signature check ran) — good enough for "route alive" test
      setTestResult(res.status === 401 || res.status === 202 ? "ok" : "fail")
    } catch {
      setTestResult("fail")
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-fg">GitHub Webhook Setup</h2>
        <p className="mt-1 text-xs text-fg/50">
          Connect GitHub PR events to open-security via a smee.io relay.
        </p>
      </div>

      {/* Step 1: Smee URL */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg/70">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white text-[10px]">
            1
          </span>
          Copy your webhook URL
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={displayUrl}
            readOnly
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!smeeChannelUrl}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      </div>

      {/* Step 2: GitHub settings */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg/70">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white text-[10px]">
            2
          </span>
          Configure in GitHub
        </div>
        <ol className="list-none space-y-1.5 text-xs text-fg/60">
          <li className="flex gap-2">
            <span className="text-fg/30">→</span>
            Go to your repo Settings → Webhooks → Add webhook
          </li>
          <li className="flex gap-2">
            <span className="text-fg/30">→</span>
            Paste the URL above into <span className="font-mono bg-surface rounded px-1">Payload URL</span>
          </li>
          <li className="flex gap-2">
            <span className="text-fg/30">→</span>
            Set Content type to <span className="font-mono bg-surface rounded px-1">application/json</span>
          </li>
          <li className="flex gap-2">
            <span className="text-fg/30">→</span>
            Select <span className="font-medium">Pull requests</span> events only
          </li>
          <li className="flex gap-2">
            <span className="text-fg/30">→</span>
            Set a <span className="font-medium">Secret</span> and paste it in the field below
          </li>
        </ol>
      </div>

      {/* Step 2b: Webhook secret input */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg/70">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white text-[10px]">
            3
          </span>
          Store webhook secret
          {secretSaved && (
            <span className="ml-2 text-[10px] text-green-600 font-normal">Secret configured</span>
          )}
        </div>

        <p className="text-xs text-fg/50">
          Enter the secret you configured on GitHub. It will be encrypted and stored securely.
        </p>

        <div className="flex items-center gap-2">
          <Input
            type="password"
            placeholder={secretSaved ? "Secret already configured — enter new value to rotate" : "Paste webhook secret"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveSecret}
            disabled={savingSecret || !secret.trim()}
          >
            {savingSecret ? "Saving..." : secretSaved ? "Rotate" : "Save"}
          </Button>
        </div>

        {secretError && (
          <p className="text-xs text-destructive">{secretError}</p>
        )}
      </div>

      {/* Step 4: Test */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg/70">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white text-[10px]">
            4
          </span>
          Test the connection
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? "Testing..." : "Send test ping"}
          </Button>
          {testResult === "ok" && (
            <span className="text-xs text-green-600">Webhook route is live</span>
          )}
          {testResult === "fail" && (
            <span className="text-xs text-destructive">Route unreachable — is the server running?</span>
          )}
        </div>
      </div>

      {/* Tunnel instruction */}
      <div className="rounded-md bg-surface-hover p-3 text-xs text-fg/60">
        <span className="font-medium text-fg/80">Running locally?</span> Start the smee relay
        with:{" "}
        <span className="font-mono text-fg/80">bun run tunnel</span>
      </div>
    </div>
  )
}
