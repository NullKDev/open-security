"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ForkButtonProps {
  /** The scan ID to fork. */
  scanId: string;
  /** Optional event ID to fork from. */
  forkEventId?: string;
}

/**
 * Button that forks a scan from an optional event checkpoint.
 *
 * - POST `/api/scans/${scanId}/fork` with `{ forkEventId }` (when provided)
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function ForkButton({ scanId, forkEventId }: ForkButtonProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleFork() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const body = forkEventId !== undefined ? JSON.stringify({ forkEventId }) : undefined;
      await fetch(`/api/scans/${scanId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body } : {}),
      });
    } catch {
      // Network error — silently ignore
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleFork}
      disabled={submitting}
      aria-label="Fork"
    >
      Fork
    </Button>
  );
}
