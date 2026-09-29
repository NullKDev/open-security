"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/** Mask a secret value — shows last 4 chars only */
function maskSecret(value: string): string {
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

interface SaveState {
  loading: boolean;
  saved: boolean;
  error: string | null;
}

function useSaveState() {
  const [state, setState] = useState<SaveState>({
    loading: false,
    saved: false,
    error: null,
  });

  async function save(target: string, body: unknown) {
    setState({ loading: true, saved: false, error: null });
    try {
      const res = await fetch(`/api/integrations/${target}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: { message: string };
      };
      if (json.success) {
        setState({ loading: false, saved: true, error: null });
      } else {
        setState({
          loading: false,
          saved: false,
          error: json.error?.message ?? "Save failed",
        });
      }
    } catch {
      setState({ loading: false, saved: false, error: "Network error" });
    }
  }

  return { state, save };
}

/**
 * /settings/integrations — Integration credentials management page.
 *
 * Provides credential forms for Jira, Slack, GitHub Code Scanning, and Socket.dev.
 * Sensitive fields are encrypted by the PUT /api/integrations/[target] route.
 * Shows masked state (last 4 chars) after saving.
 */
export default function IntegrationsPage() {
  // Jira
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraTokenSaved, setJiraTokenSaved] = useState(false);
  const jira = useSaveState();

  // Slack
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [slackSaved, setSlackSaved] = useState(false);
  const slack = useSaveState();

  // GitHub Code Scanning
  const [ghOwner, setGhOwner] = useState("");
  const [ghRepo, setGhRepo] = useState("");
  const [ghPat, setGhPat] = useState("");
  const [ghPatSaved, setGhPatSaved] = useState(false);
  const gh = useSaveState();

  // Socket
  const [socketApiKey, setSocketApiKey] = useState("");
  const [socketSaved, setSocketSaved] = useState(false);
  const socket = useSaveState();

  async function saveJira() {
    await jira.save("jira", {
      baseUrl: jiraBaseUrl,
      projectKey: jiraProjectKey,
      email: jiraEmail,
      apiToken: jiraApiToken,
    });
    if (!jira.state.error) {
      setJiraTokenSaved(true);
      setJiraApiToken("");
    }
  }

  async function saveSlack() {
    await slack.save("slack", { webhookUrl: slackWebhookUrl });
    if (!slack.state.error) {
      setSlackSaved(true);
      setSlackWebhookUrl("");
    }
  }

  async function saveGitHub() {
    await gh.save("github-code-scanning", {
      owner: ghOwner,
      repo: ghRepo,
      pat: ghPat,
    });
    if (!gh.state.error) {
      setGhPatSaved(true);
      setGhPat("");
    }
  }

  async function saveSocket() {
    await socket.save("socket", { apiKey: socketApiKey });
    if (!socket.state.error) {
      setSocketSaved(true);
      setSocketApiKey("");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-8 px-4">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure credentials for external integrations. Sensitive values are
          encrypted at rest.
        </p>
      </div>

      {/* Jira */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jira</CardTitle>
          <CardDescription>
            Export findings as Jira issues via the REST API v3.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor="jira-base-url">Base URL</Label>
              <Input
                id="jira-base-url"
                placeholder="https://yourorg.atlassian.net"
                value={jiraBaseUrl}
                onChange={(e) => setJiraBaseUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jira-email">Email</Label>
              <Input
                id="jira-email"
                type="email"
                placeholder="you@example.com"
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jira-project-key">Project Key</Label>
              <Input
                id="jira-project-key"
                placeholder="SEC"
                value={jiraProjectKey}
                onChange={(e) => setJiraProjectKey(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jira-api-token">
                API Token
                {jiraTokenSaved && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    Saved
                  </Badge>
                )}
              </Label>
              {jiraTokenSaved ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={maskSecret("saved-token")}
                    readOnly
                    className="bg-muted text-muted-foreground"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setJiraTokenSaved(false)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <Input
                  id="jira-api-token"
                  type="password"
                  placeholder="Atlassian API token"
                  value={jiraApiToken}
                  onChange={(e) => setJiraApiToken(e.target.value)}
                />
              )}
            </div>
          </div>
          {jira.state.error && (
            <p className="text-xs text-red-500">{jira.state.error}</p>
          )}
          <Button
            onClick={saveJira}
            disabled={jira.state.loading}
            size="sm"
          >
            {jira.state.loading ? "Saving…" : jira.state.saved ? "Saved!" : "Save Jira"}
          </Button>
        </CardContent>
      </Card>

      {/* Slack */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Slack</CardTitle>
          <CardDescription>
            Weekly security digest via Incoming Webhook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="slack-webhook">
              Webhook URL
              {slackSaved && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  Saved
                </Badge>
              )}
            </Label>
            {slackSaved ? (
              <div className="flex items-center gap-2">
                <Input
                  value={maskSecret("saved-url")}
                  readOnly
                  className="bg-muted text-muted-foreground"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSlackSaved(false)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <Input
                id="slack-webhook"
                type="password"
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhookUrl}
                onChange={(e) => setSlackWebhookUrl(e.target.value)}
              />
            )}
          </div>
          {slack.state.error && (
            <p className="text-xs text-red-500">{slack.state.error}</p>
          )}
          <Button onClick={saveSlack} disabled={slack.state.loading} size="sm">
            {slack.state.loading
              ? "Saving…"
              : slack.state.saved
                ? "Saved!"
                : "Save Slack"}
          </Button>
        </CardContent>
      </Card>

      {/* GitHub Code Scanning */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">GitHub Code Scanning</CardTitle>
          <CardDescription>
            Upload SARIF findings to GitHub Code Scanning.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor="gh-owner">Owner</Label>
              <Input
                id="gh-owner"
                placeholder="your-org"
                value={ghOwner}
                onChange={(e) => setGhOwner(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gh-repo">Repository</Label>
              <Input
                id="gh-repo"
                placeholder="your-repo"
                value={ghRepo}
                onChange={(e) => setGhRepo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gh-pat">
                Personal Access Token
                {ghPatSaved && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    Saved
                  </Badge>
                )}
              </Label>
              {ghPatSaved ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={maskSecret("saved-pat")}
                    readOnly
                    className="bg-muted text-muted-foreground"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setGhPatSaved(false)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <Input
                  id="gh-pat"
                  type="password"
                  placeholder="ghp_..."
                  value={ghPat}
                  onChange={(e) => setGhPat(e.target.value)}
                />
              )}
            </div>
          </div>
          {gh.state.error && (
            <p className="text-xs text-red-500">{gh.state.error}</p>
          )}
          <Button onClick={saveGitHub} disabled={gh.state.loading} size="sm">
            {gh.state.loading
              ? "Saving…"
              : gh.state.saved
                ? "Saved!"
                : "Save GitHub"}
          </Button>
        </CardContent>
      </Card>

      {/* Socket.dev */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Socket.dev</CardTitle>
          <CardDescription>
            Supply chain risk analysis for npm/PyPI packages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="socket-key">
              API Key
              {socketSaved && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  Saved
                </Badge>
              )}
            </Label>
            {socketSaved ? (
              <div className="flex items-center gap-2">
                <Input
                  value={maskSecret("saved-key")}
                  readOnly
                  className="bg-muted text-muted-foreground"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSocketSaved(false)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <Input
                id="socket-key"
                type="password"
                placeholder="socket-key-..."
                value={socketApiKey}
                onChange={(e) => setSocketApiKey(e.target.value)}
              />
            )}
          </div>
          {socket.state.error && (
            <p className="text-xs text-red-500">{socket.state.error}</p>
          )}
          <Button
            onClick={saveSocket}
            disabled={socket.state.loading}
            size="sm"
          >
            {socket.state.loading
              ? "Saving…"
              : socket.state.saved
                ? "Saved!"
                : "Save Socket"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
