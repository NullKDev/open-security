"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

type FailureReason =
  | "no-patch"
  | "unit-test-baseline-red"
  | "regression-test-invalid"
  | "vul-not-eliminated"
  | "unit-test-failed"
  | "agent-error"
  | "timeout"
  | null;

interface ProofData {
  outcome: "verified-fixed" | "fix-unverified";
  unitTestPassed: boolean | null;
  vulRunPassedPre: boolean | null;
  vulRunPassedPost: boolean | null;
  regressionTestPath: string | null;
  prePatchOutput: string | null;
  postPatchOutput: string | null;
  completedAt: string | null;
  failureReason: FailureReason;
}

interface ProofOfFixBadgeProps {
  proof: ProofData | null;
}

const FAILURE_REASON_LABELS: Record<Exclude<FailureReason, null>, string> = {
  "no-patch": "No patch available",
  "unit-test-baseline-red": "Unit test baseline red",
  "regression-test-invalid": "Regression test invalid (pre-patch passed)",
  "vul-not-eliminated": "Vulnerability not eliminated post-patch",
  "unit-test-failed": "Unit tests failed post-patch",
  "agent-error": "Agent error during triad",
  timeout: "Triad timed out",
};

/** Tick / cross icon */
function TriadResult({ passed }: { passed: boolean | null }) {
  if (passed === true) {
    return (
      <svg className="h-3.5 w-3.5 shrink-0 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (passed === false) {
    return (
      <svg className="h-3.5 w-3.5 shrink-0 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  return <span className="h-3.5 w-3.5 shrink-0 text-fg/30">—</span>;
}

interface CollapsibleOutputProps {
  label: string;
  output: string | null;
}

function CollapsibleOutput({ label, output }: CollapsibleOutputProps) {
  const [open, setOpen] = useState(false);
  if (!output) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1 text-[10px] text-fg/50 hover:text-fg transition-colors"
      >
        <svg
          className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
        </svg>
        {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-surface/50 p-2 text-[9px] font-mono text-fg/60">
          {output}
        </pre>
      )}
    </div>
  );
}

/**
 * Displays the PatchEval triad result for a finding.
 *
 * Shows verified-fixed / fix-unverified status badge with triad signals,
 * regression test path, and collapsible pre/post test output (REQ-FP-05).
 * Returns null when proof is not available.
 */
export function ProofOfFixBadge({ proof }: ProofOfFixBadgeProps) {
  if (!proof) return null;

  const isVerified = proof.outcome === "verified-fixed";

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <Badge
          variant={isVerified ? "default" : "outline"}
          className={isVerified ? "bg-success/15 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}
        >
          {isVerified ? "✅ Verified Fix" : "⚠ Unverified Fix"}
        </Badge>
        {proof.completedAt && (
          <span className="text-[10px] text-fg/30">
            {new Date(proof.completedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Failure reason */}
      {!isVerified && proof.failureReason && (
        <p className="text-xs text-warning/80">
          Reason: {FAILURE_REASON_LABELS[proof.failureReason] ?? proof.failureReason}
        </p>
      )}

      {/* Triad table */}
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <TriadResult passed={proof.unitTestPassed} />
          <span className="text-fg/60">Unit test suite (post-patch)</span>
        </div>
        <div className="flex items-center gap-2">
          <TriadResult passed={proof.vulRunPassedPre === false ? true : (proof.vulRunPassedPre === true ? false : null)} />
          <span className="text-fg/60">Regression test fails pre-patch</span>
        </div>
        <div className="flex items-center gap-2">
          <TriadResult passed={proof.vulRunPassedPost} />
          <span className="text-fg/60">Regression test passes post-patch</span>
        </div>
      </div>

      {/* Regression test path */}
      {proof.regressionTestPath && (
        <p className="font-mono text-[10px] text-fg/50 truncate">
          <span className="text-fg/30">Regression test: </span>
          {proof.regressionTestPath}
        </p>
      )}

      {/* Collapsible outputs */}
      <CollapsibleOutput label="Pre-patch output" output={proof.prePatchOutput} />
      <CollapsibleOutput label="Post-patch output" output={proof.postPatchOutput} />
    </div>
  );
}
