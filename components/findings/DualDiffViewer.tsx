"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DualDiffViewerProps {
  /** Unified diff of the applied fix (left panel) */
  fixDiff: string;
  /** Unified diff of the generated regression test (right panel) */
  regressionTestDiff: string;
  /** Filesystem path of the generated regression test file */
  regressionTestPath: string;
  className?: string;
}

interface DiffPanelProps {
  title: string;
  diff: string;
  emptyMessage: string;
  badge?: React.ReactNode;
}

/**
 * Renders a single diff panel with syntax-highlighted + / - lines.
 */
function DiffPanel({ title, diff, emptyMessage, badge }: DiffPanelProps) {
  return (
    <Card className="flex-1 min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {badge}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!diff.trim() ? (
          <div className="px-4 py-6 text-center text-xs text-fg/40 italic">
            {emptyMessage}
          </div>
        ) : (
          <ScrollArea className="h-[320px]">
            <pre className="p-3 text-[11px] font-mono leading-5 overflow-x-auto">
              {diff.split("\n").map((line, i) => {
                const isAdded = line.startsWith("+") && !line.startsWith("+++");
                const isRemoved = line.startsWith("-") && !line.startsWith("---");
                const isHunk = line.startsWith("@@");
                const isHeader = line.startsWith("---") || line.startsWith("+++");

                let cls = "block text-fg/60";
                if (isAdded) cls = "diff-added block bg-success/10 text-success";
                else if (isRemoved) cls = "diff-removed block bg-danger/10 text-danger";
                else if (isHunk) cls = "block text-accent/70";
                else if (isHeader) cls = "block text-fg/40 font-semibold";

                return (
                  <span key={i} className={cls}>
                    {line || " "}
                  </span>
                );
              })}
            </pre>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Side-by-side diff viewer for Fix & Prove results.
 *
 * Left panel shows the applied fix diff; right panel shows the generated
 * regression test diff. Both panels support syntax-highlighted + / - lines
 * with scrollable content. Empty diffs collapse gracefully (REQ-FP-05).
 *
 * @param fixDiff - Unified diff of the applied fix
 * @param regressionTestDiff - Unified diff of the regression test
 * @param regressionTestPath - File path of the regression test
 * @param className - Optional additional CSS classes
 */
export function DualDiffViewer({
  fixDiff,
  regressionTestDiff,
  regressionTestPath,
  className = "",
}: DualDiffViewerProps) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Regression test path label */}
      {regressionTestPath && (
        <p className="font-mono text-[10px] text-fg/50">
          <span className="text-fg/30">Regression test: </span>
          {regressionTestPath}
        </p>
      )}

      {/* Side-by-side panels */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <DiffPanel
          title="Fix Diff"
          diff={fixDiff}
          emptyMessage="No fix diff available"
          badge={
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-success/30 text-success">
              patch
            </Badge>
          }
        />
        <DiffPanel
          title="Regression Test"
          diff={regressionTestDiff}
          emptyMessage="No regression test diff available"
          badge={
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-accent/30 text-accent">
              test
            </Badge>
          }
        />
      </div>
    </div>
  );
}
