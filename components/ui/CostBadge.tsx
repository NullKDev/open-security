interface CostBadgeProps {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

/**
 * Compact badge/pill showing token counts and optional cost.
 *
 * - Input/output token counts always displayed
 * - Cache tokens displayed when > 0
 * - costUsd formatted to 4 decimal places with `$` prefix
 */
export function CostBadge({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  costUsd,
}: CostBadgeProps) {
  const fmt = (n: number) => String(n);

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface/60 px-2.5 py-1 text-[11px] leading-none text-fg/60 font-medium">
      {/* Token counts */}
      <span className="tabular-nums">
        <span title="Input tokens">↑{fmt(inputTokens)}</span>
        {" / "}
        <span title="Output tokens">↓{fmt(outputTokens)}</span>
      </span>

      {/* Cache indicators */}
      {(cacheReadTokens !== undefined && cacheReadTokens > 0) ||
      (cacheWriteTokens !== undefined && cacheWriteTokens > 0) ? (
        <span className="tabular-nums text-fg/40">
          <span title="Cache read">↺{fmt(cacheReadTokens ?? 0)}</span>
          {cacheWriteTokens !== undefined && cacheWriteTokens > 0 && (
            <span title="Cache write"> ↷{fmt(cacheWriteTokens)}</span>
          )}
        </span>
      ) : null}

      {/* Cost USD */}
      {costUsd !== undefined && (
        <span className="text-accent/80 tabular-nums">
          ${costUsd.toFixed(4)}
        </span>
      )}
    </span>
  );
}
