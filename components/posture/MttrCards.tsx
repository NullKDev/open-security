"use client";

interface MttrWindow {
  window: string;
  medianSeconds: number | null;
  avgSeconds: number | null;
  sampleSize: number;
  lowConfidence: boolean;
}

interface MttrCardsProps {
  windows: MttrWindow[];
}

/**
 * Displays MTTR (Mean Time To Remediate) cards for each time window (30d/60d/90d).
 *
 * Shows median time to fix, sample size, and a low-confidence indicator
 * when sample_size < 5 (REQ-MT-04).
 */
export function MttrCards({ windows }: MttrCardsProps) {
  function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === 0) return "—";
    const days = Math.round(seconds / 86400);
    if (days >= 1) return `${days}d`;
    const hours = Math.round(seconds / 3600);
    if (hours >= 1) return `${hours}h`;
    return `${Math.round(seconds / 60)}m`;
  }

  return (
    <div className="flex flex-wrap gap-4">
      {windows.map((w) => (
        <div
          key={w.window}
          className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 min-w-[110px]"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/40">
            {w.window}
          </span>
          <span className="text-2xl font-bold tabular-nums text-fg">
            {formatDuration(w.medianSeconds)}
          </span>
          <span className="text-[10px] text-fg/40">median MTTR</span>
          {w.lowConfidence && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
              n={w.sampleSize}, low confidence
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
