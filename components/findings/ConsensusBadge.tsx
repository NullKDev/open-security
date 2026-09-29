"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ScannerVote {
  detector: string;
  vote: "flagged" | "silent";
}

interface ConsensusBadgeProps {
  /** 'agree' | 'single-source' | 'conflicted' */
  consensusStatus: string | null | undefined;
  /** JSON string of ScannerVote[] */
  scannerVotes?: string | null;
}

/**
 * Display the consensus status of a finding as a colored badge.
 *
 * - green check: all scanners agree (status='agree')
 * - gray dot: only one scanner flagged (status='single-source')
 * - yellow triangle: scanners disagree (status='conflicted')
 *
 * Tooltip shows per-scanner vote breakdown when scannerVotes is provided.
 *
 * @param consensusStatus - 'agree' | 'single-source' | 'conflicted'
 * @param scannerVotes - JSON string of ScannerVote[] for tooltip
 */
export function ConsensusBadge({
  consensusStatus,
  scannerVotes,
}: ConsensusBadgeProps) {
  const status = consensusStatus ?? "single-source";

  const icon =
    status === "agree"
      ? "✓"
      : status === "conflicted"
        ? "⚠"
        : "·";

  const label =
    status === "agree"
      ? "Agree"
      : status === "conflicted"
        ? "Conflicted"
        : "Single source";

  const variant =
    status === "agree"
      ? "default"
      : status === "conflicted"
        ? "outline"
        : "secondary";

  const colorClass =
    status === "agree"
      ? "bg-green-100 text-green-800 border-green-300"
      : status === "conflicted"
        ? "bg-yellow-100 text-yellow-800 border-yellow-300"
        : "bg-gray-100 text-gray-600 border-gray-300";

  let votes: ScannerVote[] = [];
  if (scannerVotes) {
    try {
      votes = JSON.parse(scannerVotes) as ScannerVote[];
    } catch {
      // Ignore parse errors
    }
  }

  const badge = (
    <Badge
      variant={variant}
      className={`gap-1 text-[10px] font-medium ${colorClass}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Badge>
  );

  if (votes.length === 0) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            {votes.map((v) => (
              <div key={v.detector} className="flex items-center gap-2">
                <span className="font-mono">{v.detector}</span>
                <span
                  className={
                    v.vote === "flagged" ? "text-red-400" : "text-gray-400"
                  }
                >
                  {v.vote === "flagged" ? "flagged" : "silent"}
                </span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
