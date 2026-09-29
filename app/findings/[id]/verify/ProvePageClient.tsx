"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ProvePageClientProps {
  findingId: string;
  /** Whether the finding has a patch_diff — disables button if false */
  hasPatch: boolean;
}

type ProofStatus = "idle" | "submitting" | "in-progress" | "done" | "error";

/**
 * Client sub-component for the ProvePage.
 *
 * Handles the "Start Fix & Prove" button click (POST /api/findings/{id}/verify),
 * then polls GET /api/findings/{id}/proof every 3 seconds until the proof
 * reaches a terminal state (verified-fixed or fix-unverified).
 *
 * Disabled when hasPatch is false — shows an inline tip in that case.
 *
 * @param findingId - The finding ID to trigger verification for
 * @param hasPatch - Whether the finding has a patch diff available
 */
export function ProvePageClient({ findingId, hasPatch }: ProvePageClientProps) {
  const [status, setStatus] = useState<ProofStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [proofId, setProofId] = useState<string | null>(null);

  async function startVerification() {
    setStatus("submitting");
    setError(null);

    try {
      const res = await fetch(`/api/findings/${findingId}/verify`, {
        method: "POST",
      });

      if (res.status === 409) {
        setStatus("in-progress");
        setError("A verification is already in progress.");
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        setStatus("error");
        setError(`Failed to start verification: ${res.status} — ${text}`);
        return;
      }

      const data = (await res.json()) as { proofId: string; status: string };
      setProofId(data.proofId);
      setStatus("in-progress");

      // Poll for completion
      pollProof(data.proofId);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unexpected error");
    }
  }

  function pollProof(id: string) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/findings/${findingId}/proof`);
        if (!res.ok) return;

        const proof = (await res.json()) as { outcome: string };
        if (proof.outcome !== "in-progress") {
          clearInterval(interval);
          setStatus("done");
          // Reload the page to show the updated proof result
          window.location.reload();
        }
      } catch {
        // Silently continue polling
      }
    }, 3_000);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button
          onClick={startVerification}
          disabled={!hasPatch || status === "submitting" || status === "in-progress"}
          size="sm"
        >
          {status === "submitting"
            ? "Starting…"
            : status === "in-progress"
              ? "Verifying…"
              : "Start Fix & Prove"}
        </Button>

        {status === "in-progress" && proofId && (
          <Badge variant="outline" className="text-xs border-accent/30 text-accent animate-pulse">
            In progress
          </Badge>
        )}

        {status === "done" && (
          <Badge variant="outline" className="text-xs border-success/30 text-success">
            Complete
          </Badge>
        )}

        {status === "error" && (
          <Badge variant="outline" className="text-xs border-danger/30 text-danger">
            Error
          </Badge>
        )}
      </div>

      {!hasPatch && (
        <p className="text-xs text-fg/40 italic">
          Fix &amp; Prove requires a patch diff. Apply a fix first to enable this.
        </p>
      )}

      {error && (
        <p className="text-xs text-warning">{error}</p>
      )}
    </div>
  );
}
