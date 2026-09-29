"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ModelsInfoCard } from "@/components/ui/ModelsInfoCard";

export type ScanIntensity = "quick" | "standard" | "intermediate" | "paranoid";

export interface ScanConfigData {
  intensity: ScanIntensity;
  scanGitHistory: boolean;
  scanDependencies: boolean;
}

const INTENSITY_LABELS: Record<ScanIntensity, { label: string; desc: string }> = {
  quick: { label: "Quick", desc: "Classical scanners only, ~1 min" },
  standard: { label: "Standard", desc: "LLM on critical/high, secrets in history, ~5 min" },
  intermediate: { label: "Intermediate", desc: "Project map + 3–4 targeted domain passes (auth, input, data, etc.)" },
  paranoid: { label: "Paranoid", desc: "Project map + 5–7 deep domain passes with inline fix suggestions. Slow." },
};

interface Props {
  projectName: string;
  /** JSON snapshot of models_config from the project */
  modelsConfig?: string | null;
  onSubmit: (data: ScanConfigData) => void;
  loading?: boolean;
}

export function ScanConfig({ projectName, modelsConfig, onSubmit, loading = false }: Props) {
  const [intensity, setIntensity] = useState<ScanIntensity>("standard");
  const [scanGitHistory, setScanGitHistory] = useState(true);
  const [scanDependencies, setScanDependencies] = useState(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ intensity, scanGitHistory, scanDependencies });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-fg/50">
        Scanning <span className="font-medium text-fg">{projectName}</span>
      </p>

      {/* Models info — read-only display of configured models */}
      <ModelsInfoCard modelsJson={modelsConfig ?? null} />

      {/* Intensity */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-fg/60">Intensity</label>
        <div className="space-y-1">
          {(["quick", "standard", "intermediate", "paranoid"] as ScanIntensity[]).map((i) => (
            <label
              key={i}
              className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors duration-150 ${
                intensity === i
                  ? "border-accent/30 bg-accent/5"
                  : "border-border hover:border-fg/20"
              }`}
            >
              <input
                type="radio"
                name="intensity"
                value={i}
                checked={intensity === i}
                onChange={() => setIntensity(i)}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-fg">{INTENSITY_LABELS[i].label}</span>
                <span className="block text-[11px] text-fg/40 leading-tight">
                  {INTENSITY_LABELS[i].desc}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-fg">Scan git history</span>
          <input
            type="checkbox"
            checked={scanGitHistory}
            onChange={(e) => setScanGitHistory(e.target.checked)}
            className="accent-accent h-4 w-4"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-fg">Scan dependencies</span>
          <input
            type="checkbox"
            checked={scanDependencies}
            onChange={(e) => setScanDependencies(e.target.checked)}
            className="accent-accent h-4 w-4"
          />
        </label>
      </div>

      <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
        Start Scan
      </Button>
    </form>
  );
}
