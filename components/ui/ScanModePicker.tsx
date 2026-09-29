"use client";

import type { ScanMode } from "@/lib/repos/scans.repo";

const MODES: { value: ScanMode; label: string; cost: string; desc: string }[] = [
  { value: "quick", label: "Quick", cost: "free", desc: "Classical scanners only — fast, no LLM cost." },
  { value: "standard", label: "Standard", cost: "~50k tok", desc: "One LLM pass over the repo with stack-aware skill rules." },
  { value: "intermediate", label: "Intermediate", cost: "~150k tok", desc: "Project map + 3–4 targeted domain passes (auth, input, data, etc.)." },
  { value: "paranoid", label: "Paranoid", cost: "~350k tok", desc: "Project map + 5–7 deep domain passes with inline fix suggestions. Slow." },
];

interface Props {
  value: ScanMode;
  onChange: (mode: ScanMode) => void;
}

export function ScanModePicker({ value, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-fg/80">Scan mode</label>
      <div className="grid grid-cols-2 gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
              value === m.value
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-fg/70 hover:bg-surface/80 hover:border-fg/20"
            }`}
          >
            <span className="block text-sm font-semibold">{m.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-fg/50">{m.desc}</span>
            <span className="mt-0.5 block text-[10px] font-medium text-fg/30">{m.cost}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
