"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"

interface GithubIntegrationStatusProps {
  /** Whether a GitHub token is configured (from public config) */
  hasToken: boolean
}

/**
 * Shows GitHub integration status in the Settings page.
 *
 * Displays whether a GitHub token is configured and a test button
 * that calls GET https://api.github.com/user to verify the token works.
 * Makes the request via the local API proxy to keep the token server-side.
 *
 * @param props.hasToken - Whether githubToken is set in config
 */
export function GithubIntegrationStatus({ hasToken }: GithubIntegrationStatusProps) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ login?: string; error?: string } | null>(null)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)

    try {
      const res = await fetch("/api/github/whoami")
      if (res.ok) {
        const body = await res.json()
        setTestResult({ login: body.data?.login })
      } else {
        setTestResult({ error: `HTTP ${res.status}` })
      }
    } catch {
      setTestResult({ error: "Connection failed" })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${hasToken ? "bg-green-500" : "bg-fg/20"}`}
        />
        <span className="text-sm text-fg">
          {hasToken ? "GitHub token configured" : "No GitHub token"}
        </span>
      </div>

      {!hasToken && (
        <p className="text-xs text-fg/50">
          Add <span className="font-mono">githubToken</span> to your config to enable
          PR comments and apply-fix functionality.
        </p>
      )}

      {hasToken && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? "Testing..." : "Test connection"}
          </Button>

          {testResult?.login && (
            <span className="text-xs text-green-600">
              Authenticated as @{testResult.login}
            </span>
          )}
          {testResult?.error && (
            <span className="text-xs text-destructive">
              {testResult.error}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
