"use client";

interface RegressionRateBadgeProps {
  rate30d: number;
  count30d: number;
  totalFixes30d: number;
}

/**
 * Displays the 30-day regression rate as a badge.
 *
 * Rate is shown as a percentage; elevated rates (>= 10%) use a warning color.
 * Renders a status role element for accessibility (REQ-RT-05).
 */
export function RegressionRateBadge({
  rate30d,
  count30d,
  totalFixes30d,
}: RegressionRateBadgeProps) {
  const pct = Math.round(rate30d * 100);
  const isElevated = rate30d >= 0.1;

  return (
    <div
      role="status"
      aria-label={`Regression rate: ${pct}%`}
      className={`inline-flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 ${
        isElevated
          ? "border-warning/30 bg-warning/10"
          : "border-border bg-card"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/40">
        Regression Rate (30d)
      </span>
      <span
        className={`text-2xl font-bold tabular-nums ${
          isElevated ? "text-warning" : "text-fg"
        }`}
      >
        {pct}%
      </span>
      <span className="text-[10px] text-fg/40">
        {count30d} of {totalFixes30d} fixes
      </span>
    </div>
  );
}
