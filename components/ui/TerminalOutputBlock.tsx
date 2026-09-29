interface TerminalOutputBlockProps {
  command?: string;
  output: string;
  exitCode?: number;
}

/**
 * Renders terminal output in a monospace block.
 *
 * - Shows command as header when provided (e.g. `$ npm test`)
 * - Output rendered in `<pre>` with preserved whitespace
 * - Non-zero exitCode renders with red/danger border and exit code indicator
 * - Zero exitCode renders with normal/green style
 * - Undefined exitCode renders with neutral style
 */
export function TerminalOutputBlock({
  command,
  output,
  exitCode,
}: TerminalOutputBlockProps) {
  const isError = exitCode !== undefined && exitCode !== 0;
  const isSuccess = exitCode === 0;

  const borderStyle = isError
    ? "border-danger/40 bg-danger/[0.02]"
    : isSuccess
      ? "border-success/20 bg-surface/30"
      : "border-border/30 bg-surface/20";

  const headerStyle = isError
    ? "text-danger/80"
    : isSuccess
      ? "text-success/70"
      : "text-fg/50";

  return (
    <div
      className={`my-1 rounded-md border px-3 py-2 text-xs ${borderStyle}`}
    >
      {/* Header: command + exit code */}
      <div className="flex items-baseline gap-2 mb-1.5">
        {command && (
          <span className={`font-mono text-[11px] font-medium ${headerStyle}`}>
            $ {command}
          </span>
        )}
        {exitCode !== undefined && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold tabular-nums ${
              isError
                ? "bg-danger/10 text-danger/80"
                : isSuccess
                  ? "bg-success/10 text-success/70"
                  : "bg-fg/5 text-fg/40"
            }`}
          >
            {isError && <span>Exit code: </span>}
            {exitCode}
          </span>
        )}
      </div>

      {/* Output */}
      <pre className="text-[11px] leading-relaxed text-fg/60 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
        {output}
      </pre>
    </div>
  );
}
