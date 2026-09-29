"use client";

import { useEffect, useRef, useState } from "react";
import {
  isTerminalBranchStatus,
  branchStatusLabel,
  branchStatusColor,
} from "@/lib/ui/branch-status";

interface BranchDTO {
  id: string;
  findingId: string;
  branchRef: string | null;
  status: string;
  applyError: string | null;
  testsOutput: string | null;
  testsPassed: number | null;
  createdAt: string;
  updatedAt: string;
}

interface BranchStatusPillProps {
  findingId: string;
  /** Initial status fetched server-side. The component polls if not terminal. */
  initialStatus: string;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Client component that displays the current branch remediation status for a
 * finding. Polls GET /api/findings/[id]/branch every 2s while the status is
 * in a non-terminal state (pending, creating, tests_running).
 */
export function BranchStatusPill({
  findingId,
  initialStatus,
}: BranchStatusPillProps) {
  const [status, setStatus] = useState(initialStatus);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isTerminalBranchStatus(status)) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/findings/${findingId}/branch`);
        if (!res.ok) return;
        const body: { data: BranchDTO } = await res.json();
        setStatus(body.data.status);
      } catch {
        // network errors are silently ignored — polling will retry
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [findingId, status]);

  const isActive = !isTerminalBranchStatus(status);
  const color = branchStatusColor(status);
  const label = branchStatusLabel(status);

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${color}`}>
      {isActive ? (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-pulse shrink-0"
          aria-hidden
        />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" aria-hidden />
      )}
      {label}
    </span>
  );
}
