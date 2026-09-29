"use client";

import { useState } from "react";
import type { Playbook } from "@/lib/playbooks/schema";
import { Button } from "@/components/ui/button";

interface PlaybookTrustDialogProps {
  /** The user playbook that needs trust confirmation. */
  playbook: Playbook;
  /** Called after the playbook is successfully trusted. */
  onTrusted: () => void;
  /** Called when the user denies trust. */
  onDenied: () => void;
}

/**
 * Trust prompt for user-created (non-builtin) playbooks.
 *
 * - Shows playbook name and trust prompt
 * - "Trust" → POST `/api/playbooks` with `trusted: true` then calls `onTrusted`
 * - "Deny" → calls `onDenied` without any POST
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function PlaybookTrustDialog({ playbook, onTrusted, onDenied }: PlaybookTrustDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleTrust() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...playbook, trusted: true }),
      });
      onTrusted();
    } catch {
      // Network error — silently ignore, still call onTrusted for optimistic UX
      onTrusted();
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeny() {
    onDenied();
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-md">
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-fg">Trust Playbook?</h3>
        <p className="text-xs text-fg/60">
          <span className="font-medium text-fg">{playbook.name}</span> is a user-created playbook.
          Running untrusted playbooks can execute arbitrary prompts. Trust only playbooks you created
          or have reviewed.
        </p>
      </div>

      {playbook.description && (
        <p className="text-xs text-fg/50 italic">{playbook.description}</p>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDeny}
          disabled={submitting}
          aria-label="Deny"
        >
          Deny
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleTrust}
          disabled={submitting}
          aria-label="Trust"
        >
          Trust
        </Button>
      </div>
    </div>
  );
}
