"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ToolCallPromptProps {
  /** The scan ID this tool call belongs to. */
  scanId: string;
  /** The tool call ID to approve or reject. */
  toolCallId: string;
  /** Called when the user approves the tool call. */
  onApprove: () => void;
  /** Called when the user denies the tool call. */
  onDeny: () => void;
}

type Stage = "idle" | "deny-redirect";

/**
 * Prompt UI for approving or denying a pending tool call.
 *
 * - Shows Approve / Deny buttons in idle state
 * - On Deny: reveals a redirect instruction textarea
 * - On Confirm (with redirect): POST `/api/scans/${scanId}/reject-tool` with
 *   `{ toolCallId, reason, redirectInstruction }`
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function ToolCallPrompt({ scanId, toolCallId, onApprove, onDeny }: ToolCallPromptProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [redirectInstruction, setRedirectInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleApprove() {
    onApprove();
  }

  function handleDenyClick() {
    // Immediately call onDeny and reveal redirect form for optional redirect
    setStage("deny-redirect");
    onDeny();
  }

  async function handleConfirmDeny() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/scans/${scanId}/reject-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolCallId,
          reason: "denied",
          redirectInstruction,
        }),
      });
    } catch {
      // Network error — silently ignore
    } finally {
      setSubmitting(false);
      // onDeny was already called when Deny button was clicked
    }
  }

  if (stage === "deny-redirect") {
    return (
      <div className="space-y-3 rounded-md border border-border bg-surface p-4">
        <p className="text-sm font-medium text-fg">Redirect instruction (optional)</p>
        <Textarea
          value={redirectInstruction}
          onChange={(e) => setRedirectInstruction(e.target.value)}
          placeholder="Provide an alternative instruction for the agent…"
          disabled={submitting}
          rows={3}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setStage("idle"); setRedirectInstruction(""); }}
            disabled={submitting}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleConfirmDeny}
            disabled={submitting}
            aria-label="Confirm"
          >
            Confirm
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={handleApprove}
        aria-label="Approve"
      >
        Approve
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={handleDenyClick}
        aria-label="Deny"
      >
        Deny
      </Button>
    </div>
  );
}
