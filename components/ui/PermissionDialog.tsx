"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PermissionDialogProps {
  requestId: string;
  toolName: string;
  input: unknown;
  timeoutMs: number;
  scanId: string;
  onSettled: () => void;
}

/**
 * Modal dialog for approving or denying a tool permission request.
 *
 * - Shows countdown timer from `timeoutMs` (in seconds)
 * - Approve: POST `/api/scans/${scanId}/permission` with `{ requestId, approved: true }`
 * - Deny: POST with `{ requestId, approved: false }`
 * - Auto-dismiss on timeout (no POST)
 * - Calls `onSettled()` after POST completes or timeout fires
 * - Disables buttons while request is in flight
 */
export function PermissionDialog({
  requestId,
  toolName,
  input,
  timeoutMs,
  scanId,
  onSettled,
}: PermissionDialogProps) {
  const [remaining, setRemaining] = useState(Math.ceil(timeoutMs / 1000));
  const [submitting, setSubmitting] = useState(false);
  const [settled, setSettled] = useState(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  // Countdown
  useEffect(() => {
    if (settled) return;

    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(interval);
          return 0;
        }
        return r - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [settled]);

  // Timeout handler
  useEffect(() => {
    if (settled) return;

    const timer = setTimeout(() => {
      setSettled(true);
      onSettledRef.current();
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [timeoutMs, settled]);

  const doPost = useCallback(
    async (approved: boolean) => {
      if (settled || submitting) return;
      setSubmitting(true);

      try {
        await fetch(`/api/scans/${scanId}/permission`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, approved }),
        });
      } catch {
        // Network error — still dismiss
      } finally {
        setSettled(true);
        onSettledRef.current();
      }
    },
    [requestId, scanId, settled, submitting],
  );

  // Once settled, dismiss
  if (settled) return null;

  const formattedInput =
    typeof input === "string"
      ? input
      : JSON.stringify(input, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">Permission Required</h2>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs font-mono font-bold tabular-nums ${
              remaining <= 10
                ? "bg-danger/10 text-danger/80"
                : "bg-accent/10 text-accent/70"
            }`}
          >
            {remaining}s
          </span>
        </div>

        {/* Tool info */}
        <div className="space-y-2">
          <div>
            <span className="text-[10px] uppercase tracking-wide text-fg/40 font-medium">
              Tool
            </span>
            <p className="mt-0.5 text-sm font-mono text-fg/80 font-medium">{toolName}</p>
          </div>

          <div>
            <span className="text-[10px] uppercase tracking-wide text-fg/40 font-medium">
              Input
            </span>
            <pre className="mt-0.5 max-h-32 overflow-y-auto rounded border border-border/50 bg-bg px-2.5 py-1.5 text-[11px] leading-relaxed text-fg/60 font-mono whitespace-pre-wrap break-words">
              {formattedInput}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <button
            type="button"
            disabled={submitting}
            onClick={() => doPost(false)}
            className="inline-flex items-center justify-center h-10 px-4 text-sm font-medium rounded-md border border-border text-fg hover:bg-surface active:bg-border disabled:opacity-40 transition-colors duration-[120ms] select-none"
          >
            Deny
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => doPost(true)}
            className="inline-flex items-center justify-center h-10 px-4 text-sm font-medium rounded-md bg-accent text-white hover:brightness-110 active:brightness-95 disabled:opacity-50 transition-colors duration-[120ms] select-none"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
