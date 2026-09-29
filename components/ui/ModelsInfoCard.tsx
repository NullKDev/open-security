"use client";

import type { StageId } from "@/lib/config/schema";

const STAGE_LABELS: Record<StageId, string> = {
  "llm-scan": "LLM Scan",
  validate: "Validation",
  filter: "Filter",
  patch: "Patch",
};

interface Props {
  /** JSON-stringified Record<StageId, string> from the project's models_config */
  modelsJson: string | null;
}

/** Parsed model config shape — mirrors ObtConfig.models */
type ModelsMap = Partial<Record<StageId, string>>;

function parseModels(raw: string | null): ModelsMap {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ModelsMap;
  } catch {
    return {};
  }
}

export function ModelsInfoCard({ modelsJson }: Props) {
  const models = parseModels(modelsJson);
  const entries = Object.entries(models) as [StageId, string][];

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface/50 px-3 py-2.5">
        <p className="text-xs font-medium text-fg/60">Scan Models</p>
        <p className="mt-1 text-[11px] text-fg/40">
          No models configured. Configure them in{" "}
          <a href="/config" className="text-accent underline underline-offset-2">
            Settings
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface/50 px-3 py-2.5 space-y-1.5">
      <p className="text-xs font-medium text-fg/60">Scan Models</p>
      <div className="space-y-0.5">
        {entries.map(([stage, model]) => {
          const label = STAGE_LABELS[stage] ?? stage;
          return (
            <div
              key={stage}
              className="flex items-center justify-between text-[11px]"
            >
              <span className="text-fg/50">{label}</span>
              <span className="font-mono text-fg/70 truncate ml-2 max-w-[140px]">
                {model || "—"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-fg/30 leading-tight mt-1">
        Models are configured per project. Change them in{" "}
        <a href="/config" className="text-accent/60 underline underline-offset-2">
          Settings
        </a>
        .
      </p>
    </div>
  );
}
