"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const FP_TYPES = [
  { value: "not_vulnerable", label: "Not vulnerable" },
  { value: "accepted_risk", label: "Accepted risk" },
  { value: "wont_fix", label: "Won't fix" },
  { value: "duplicate", label: "Duplicate" },
] as const;

type FpType = (typeof FP_TYPES)[number]["value"];

interface DismissDialogProps {
  findingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful dismissal. */
  onDismissed: () => void;
}

/**
 * Modal dialog that collects a dismiss reason and FP type, then calls
 * POST /api/findings/[id]/dismiss.
 */
export function DismissDialog({
  findingId,
  open,
  onOpenChange,
  onDismissed,
}: DismissDialogProps) {
  const [reason, setReason] = useState("");
  const [fpType, setFpType] = useState<FpType>("not_vulnerable");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonTooShort = reason.trim().length < 10;

  async function handleSubmit() {
    if (reasonTooShort) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), fpType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to dismiss finding");
        return;
      }
      onOpenChange(false);
      setReason("");
      setFpType("not_vulnerable");
      onDismissed();
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss finding</DialogTitle>
          <DialogDescription>
            Explain why this finding is a false positive. This will be added to
            the FP bank and suppress future occurrences with the same signature.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* FP type selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {FP_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setFpType(t.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    fpType === t.value
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-fg/60 hover:border-accent/50 hover:text-fg"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reason input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg" htmlFor="dismiss-reason">
              Reason{" "}
              <span className="text-fg/40 font-normal">
                (min 10 characters)
              </span>
            </label>
            <Textarea
              id="dismiss-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this is not a real vulnerability…"
              rows={3}
            />
            {reason.length > 0 && reasonTooShort && (
              <p className="text-xs text-destructive">
                Reason must be at least 10 characters
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter showCloseButton>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={reasonTooShort || submitting}
          >
            {submitting ? "Dismissing…" : "Dismiss finding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
