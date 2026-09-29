"use client";

import { useEffect, useState } from "react";

interface StatusPillProps {
  label: string;
  startedAt?: number;
  /** When true shows as "done" styling */
  done?: boolean;
}

const SLOW_THRESHOLD_S = 12;

const STATUS_COLORS: Record<string, string> = {
  Thinking: "text-accent",
  Streaming: "text-success",
  Complete: "text-success",
  Error: "text-danger",
};

export function StatusPill({ label, startedAt, done }: StatusPillProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [done]);

  const elapsedSec = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const slow = elapsedSec >= SLOW_THRESHOLD_S && !done;
  const color = STATUS_COLORS[label] ?? "text-fg/60";

  return (
    <div className={`flex items-center gap-2 text-xs ${color}`}>
      {/* Dot */}
      {done ? (
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <span
          className="h-2 w-2 rounded-full bg-current animate-pulse shrink-0"
          aria-hidden
        />
      )}

      {/* Label */}
      <span className="font-medium">{label}</span>

      {/* Elapsed */}
      {startedAt && !done && (
        <span className="tabular-nums text-fg/40">
          {elapsedSec}s
          {slow && <span className="ml-1 text-warning"> · slow</span>}
        </span>
      )}
    </div>
  );
}
