"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BranchStatusPill } from "@/components/ui/BranchStatusPill";
import { DismissDialog } from "@/components/ui/DismissDialog";
import { ConsensusBadge } from "@/components/findings/ConsensusBadge";
import { formatAge, formatEpss, severityColorClass } from "@/lib/ui/queue-formatters";
import type { QueueRowDTO } from "@/lib/repos/queue.repo";

interface QueueItemProps {
  finding: QueueRowDTO;
  /** Current branch status fetched server-side (null if no branch yet). */
  branchStatus?: string | null;
}

/**
 * Finding card for the queue view.
 *
 * Displays severity, EPSS score, KEV indicator, age, repo/file path, and
 * action buttons for confirming a fix branch or dismissing as a false positive.
 */
export function QueueItem({ finding, branchStatus }: QueueItemProps) {
  const router = useRouter();
  const tCommon = useTranslations("common");
  const [dismissOpen, setDismissOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [currentBranchStatus, setCurrentBranchStatus] = useState<
    string | null
  >(branchStatus ?? null);

  const severityClasses = severityColorClass(finding.severity);

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/findings/${finding.id}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok || res.status === 202) {
        setCurrentBranchStatus("pending");
      }
    } catch {
      // Silently ignore network errors; the button will re-enable
    } finally {
      setConfirming(false);
    }
  }

  function handleDismissed() {
    // Refresh the server component to remove this item from the queue
    router.refresh();
  }

  const hasBranch = currentBranchStatus !== null;

  return (
    <>
      <div className="rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-hover">
        <div className="flex flex-col gap-3">
          {/* Top row: severity + EPSS + KEV + age */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Severity badge */}
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityClasses}`}
            >
              {finding.severity}
            </span>

            {/* EPSS score */}
            {finding.epssScore !== null && finding.epssScore !== undefined && (
              <Badge variant="outline" className="gap-1">
                <span className="text-fg/50">EPSS</span>
                <span>{formatEpss(finding.epssScore)}</span>
              </Badge>
            )}

            {/* KEV indicator */}
            {finding.cisaKev === 1 && (
              <Badge
                variant="destructive"
                className="font-bold tracking-wide"
              >
                KEV
              </Badge>
            )}

            {/* Consensus badge (v1.0) */}
            {(finding as Record<string, unknown>).consensusStatus && (
              <ConsensusBadge
                consensusStatus={(finding as Record<string, unknown>).consensusStatus as string}
                scannerVotes={(finding as Record<string, unknown>).scannerVotes as string | undefined}
              />
            )}

            {/* Age */}
            <span className="ml-auto text-[11px] text-fg/40 tabular-nums">
              {formatAge(finding.firstDetectedAt)}
            </span>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-sm text-fg leading-snug">
            {finding.title}
          </h3>

          {/* Location */}
          <p className="font-mono text-[11px] text-fg/50 truncate">
            {finding.projectName}
            {finding.locationPath ? ` · ${finding.locationPath}` : ""}
          </p>

          {/* Occurrence count */}
          {finding.occurrenceCount > 1 && (
            <p className="text-[11px] text-fg/40">
              Seen {finding.occurrenceCount} times
            </p>
          )}

          {/* Branch status pill */}
          {hasBranch && currentBranchStatus && (
            <div>
              <BranchStatusPill
                findingId={finding.id}
                initialStatus={currentBranchStatus}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {!hasBranch && finding.patchDiff && (
              <Button
                variant="default"
                size="sm"
                onClick={handleConfirm}
                disabled={confirming}
              >
                {confirming ? "Creating…" : tCommon("confirm")}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setDismissOpen(true)}
            >
              {tCommon("dismiss")}
            </Button>
          </div>
        </div>
      </div>

      <DismissDialog
        findingId={finding.id}
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        onDismissed={handleDismissed}
      />
    </>
  );
}
