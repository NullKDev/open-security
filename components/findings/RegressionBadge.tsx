interface RegressionBadgeProps {
  className?: string;
}

/**
 * Orange REGRESSION pill badge.
 *
 * Stateless — no side effects or dependencies. Renders an accessible badge
 * indicating a finding has regressed after a previously-merged fix (REQ-RT-03).
 */
export function RegressionBadge({ className = "" }: RegressionBadgeProps) {
  return (
    <span
      aria-label="regression finding"
      className={`inline-flex items-center gap-1 rounded-full border border-orange-400/40 bg-orange-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-500 ${className}`}
    >
      <svg
        className="h-2.5 w-2.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M1 4v6h6" />
        <path d="M23 20v-6h-6" />
        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
      </svg>
      Regression
    </span>
  );
}
