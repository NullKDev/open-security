"use client";

import { useEffect, useState, useCallback, type FormEvent } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ModelOption {
  id: string;
  label: string;
}

interface CliAgent {
  id: string;
  type: "cli";
  name: string;
  bin: string;
  available: boolean;
  version: string | null;
  models: ModelOption[];
}

interface ApiProvider {
  id: string;
  type: "api";
  label: string;
  models: ModelOption[];
}

interface ProvidersData {
  cli: CliAgent[];
  api: ApiProvider[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STAGES = [
  { key: "llm-scan", label: "LLM Scan" },
  { key: "validate", label: "Validate" },
  { key: "filter", label: "Filter" },
  { key: "patch", label: "Patch" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a config string like "cli:claude:claude-sonnet-4-5" or
 * "api:anthropic:claude-sonnet-4-5" into { providerKey, modelId }.
 */
function parseConfigValue(raw: string | null | undefined): {
  providerKey: string;
  modelId: string;
} {
  if (!raw) return { providerKey: "", modelId: "" };
  const parts = raw.split(":");
  if (parts[0] === "cli" && parts.length >= 2) {
    return {
      providerKey: `cli:${parts[1]}`,
      modelId: parts.slice(2).join(":") || "default",
    };
  }
  if (parts[0] === "api" && parts.length >= 3) {
    return {
      providerKey: `api:${parts[1]}`,
      modelId: parts.slice(2).join(":"),
    };
  }
  return { providerKey: "", modelId: "" };
}

/**
 * Rebuild the config string from providerKey + modelId.
 * Returns null when no provider is selected.
 */
function buildConfigValue(
  providerKey: string,
  modelId: string
): string | null {
  if (!providerKey) return null;
  if (providerKey.startsWith("cli:")) {
    if (!modelId || modelId === "default") return providerKey;
    return `${providerKey}:${modelId}`;
  }
  if (!modelId) return null;
  return `${providerKey}:${modelId}`;
}

function getModelsForProvider(
  providerKey: string,
  providers: ProvidersData
): ModelOption[] {
  if (!providerKey) return [];
  if (providerKey.startsWith("cli:")) {
    const agentId = providerKey.slice(4);
    const agent = providers.cli.find((a) => a.id === agentId);
    return agent?.models ?? [{ id: "default", label: "Default (CLI config)" }];
  }
  const apiId = providerKey.slice(4);
  const apiProvider = providers.api.find((p) => p.id === apiId);
  return apiProvider?.models ?? [];
}

/**
 * Render model <option> elements grouped by provider prefix.
 */
function ModelOptions({ models }: { models: ModelOption[] }) {
  const groups = new Map<string, ModelOption[]>();
  const flat: ModelOption[] = [];

  for (const m of models) {
    const slash = m.id.indexOf("/");
    if (m.id === "default" || slash <= 0) {
      flat.push(m);
      continue;
    }
    const provider = m.id.slice(0, slash);
    const arr = groups.get(provider) ?? [];
    arr.push(m);
    groups.set(provider, arr);
  }

  if (groups.size === 0) {
    return (
      <>
        {flat.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </>
    );
  }

  return (
    <>
      {flat.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
      {Array.from(groups.entries()).map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label.startsWith(`${provider}/`)
                ? m.label.slice(provider.length + 1)
                : m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

type StageState = { providerKey: string; modelId: string };

/**
 * Providers configuration page — moved from /config.
 * Assign LLM providers and models per pipeline stage.
 */
export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProvidersData | null>(null);
  const [stages, setStages] = useState<Record<StageKey, StageState>>(
    () =>
      Object.fromEntries(
        STAGES.map((s) => [s.key, { providerKey: "", modelId: "" }])
      ) as Record<StageKey, StageState>
  );
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/providers");
      const d = await res.json();
      if (d.success) setProviders(d.data);
    } catch {}
    setScanning(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const [configRes, providersRes] = await Promise.all([
        fetch("/api/config")
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/providers")
          .then((r) => r.json())
          .catch(() => null),
      ]);

      if (cancelled) return;

      const pdata: ProvidersData | null =
        providersRes?.success && Array.isArray(providersRes.data?.cli)
          ? providersRes.data
          : null;
      if (pdata) setProviders(pdata);

      if (configRes?.success && pdata) {
        const rawModels: Record<string, string | null> =
          configRes.data?.models ?? {};
        setStages(
          Object.fromEntries(
            STAGES.map((s) => {
              const parsed = parseConfigValue(rawModels[s.key]);
              const models = getModelsForProvider(parsed.providerKey, pdata);
              const validModel =
                models.find((m) => m.id === parsed.modelId) ?? models[0];
              return [
                s.key,
                {
                  providerKey: parsed.providerKey,
                  modelId: validModel?.id ?? parsed.modelId,
                },
              ];
            })
          ) as Record<StageKey, StageState>
        );
      }

      setLoading(false);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProviderChange = (stageKey: StageKey, providerKey: string) => {
    const models = getModelsForProvider(providerKey, providers ?? { cli: [], api: [] });
    setStages((prev) => ({
      ...prev,
      [stageKey]: { providerKey, modelId: models[0]?.id ?? "" },
    }));
  };

  const handleModelChange = (stageKey: StageKey, modelId: string) => {
    setStages((prev) => ({
      ...prev,
      [stageKey]: { ...prev[stageKey], modelId },
    }));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const models = Object.fromEntries(
      STAGES.map((s) => {
        const { providerKey, modelId } = stages[s.key];
        return [s.key, buildConfigValue(providerKey, modelId)];
      })
    );
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models }),
      });
      setMessage(res.ok ? "Saved successfully." : "Failed to save.");
    } catch {
      setMessage("Network error.");
    }
    setSaving(false);
  };

  const providerOptions = providers
    ? [
        { key: "", label: "None (disabled)", disabled: false, badge: null },
        ...providers.cli.map((a) => ({
          key: `cli:${a.id}`,
          label: a.name,
          disabled: !a.available,
          badge: a.available ? (a.version ?? "installed") : "not installed",
        })),
        ...providers.api.map((p) => ({
          key: `api:${p.id}`,
          label: p.label,
          disabled: false,
          badge: null,
        })),
      ]
    : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-fg">
          Providers
        </h1>
      </div>

      {/* Provider Matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Matrix</CardTitle>
          <CardDescription>
            Assign an LLM provider and model per pipeline stage.
          </CardDescription>
          <CardAction>
            <Button
              variant="secondary"
              loading={scanning}
              onClick={fetchProviders}
              title="Re-scan for installed CLI agents"
            >
              Rescan
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="text-sm text-fg/50">Detecting agents…</p>
          ) : (
            <form onSubmit={handleSave}>
              {/* Header row */}
              <div className="flex items-center gap-3 pb-2 border-b border-border/30 mb-1">
                <span className="w-24 text-xs font-medium text-fg/50 uppercase tracking-wider">
                  Stage
                </span>
                <span className="w-44 text-xs font-medium text-fg/50 uppercase tracking-wider">
                  Provider
                </span>
                <span className="flex-1 text-xs font-medium text-fg/50 uppercase tracking-wider">
                  Model
                </span>
                <span className="w-28 text-xs font-medium text-fg/50 uppercase tracking-wider">
                  Status
                </span>
              </div>

              <div className="space-y-2">
                {STAGES.map((stage) => {
                  const { providerKey, modelId } = stages[stage.key];
                  const models = getModelsForProvider(
                    providerKey,
                    providers ?? { cli: [], api: [] }
                  );
                  const isCliAgent =
                    providerKey.startsWith("cli:") && !!providers;
                  const agent = isCliAgent
                    ? providers!.cli.find((a) => `cli:${a.id}` === providerKey)
                    : null;

                  return (
                    <div
                      key={stage.key}
                      className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0"
                    >
                      <span className="w-24 text-sm font-medium text-fg shrink-0">
                        {stage.label}
                      </span>

                      <select
                        className="w-44 shrink-0 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
                        value={providerKey}
                        onChange={(e) =>
                          handleProviderChange(stage.key, e.target.value)
                        }
                      >
                        {providerOptions.map((o) => (
                          <option
                            key={o.key}
                            value={o.key}
                            disabled={o.disabled}
                          >
                            {o.label}
                            {o.disabled ? " (not installed)" : ""}
                          </option>
                        ))}
                      </select>

                      <select
                        className="flex-1 min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none disabled:opacity-40"
                        value={modelId}
                        disabled={!providerKey || models.length === 0}
                        onChange={(e) =>
                          handleModelChange(stage.key, e.target.value)
                        }
                      >
                        {models.length === 0 ? (
                          <option value="">—</option>
                        ) : (
                          <ModelOptions models={models} />
                        )}
                      </select>

                      <div className="w-28 shrink-0 flex items-center gap-1.5">
                        {agent ? (
                          <>
                            <span
                              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                agent.available ? "bg-success" : "bg-danger"
                              }`}
                            />
                            <span className="text-xs text-fg/50 truncate">
                              {agent.available
                                ? (agent.version ?? "installed")
                                : "not installed"}
                            </span>
                          </>
                        ) : providerKey.startsWith("api:") ? (
                          <span className="text-xs text-fg/40">API key req.</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex items-center gap-3">
                <Button type="submit" variant="primary" loading={saving}>
                  Save
                </Button>
                {message && (
                  <span
                    className={`text-sm ${
                      message.includes("success")
                        ? "text-success"
                        : "text-danger"
                    }`}
                  >
                    {message}
                  </span>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* CLI Agents Status */}
      {providers && (
        <Card>
          <CardHeader>
            <CardTitle>Detected CLI Agents</CardTitle>
            <CardDescription>Local AI tools found on your PATH.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {providers.cli.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 py-1.5"
                >
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      agent.available ? "bg-success" : "bg-fg/20"
                    }`}
                  />
                  <span className="text-sm font-medium text-fg w-32">
                    {agent.name}
                  </span>
                  <span className="text-xs text-fg/40 font-mono">{agent.bin}</span>
                  {agent.available && agent.version && (
                    <span className="ml-auto text-xs text-fg/40">
                      {agent.version}
                    </span>
                  )}
                  {!agent.available && (
                    <span className="ml-auto text-xs text-fg/30">
                      not installed
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Coming Soon */}
      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button variant="secondary" disabled title="Coming Soon">
              Export PDF
            </Button>
            <Button variant="secondary" disabled title="Coming Soon">
              Generate PoC
            </Button>
            <span className="self-center text-xs text-fg/40">Coming Soon</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
