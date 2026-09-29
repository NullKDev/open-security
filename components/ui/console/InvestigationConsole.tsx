"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface InvestigationConsoleProps {
  /** The scan ID to inject prompts into. */
  scanId: string;
  /** Current scan status. Input is disabled when not 'running'. */
  status: string;
}

/**
 * Chat console component for injecting investigation prompts into a running scan.
 *
 * - Renders a text input + send button at the bottom of the investigation view
 * - Disabled when `status !== 'running'`
 * - On submit: POST `/api/scans/${scanId}/inject-prompt` with `{ content }`
 * - Clears input after successful submission
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function InvestigationConsole({ scanId, status }: InvestigationConsoleProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isEnabled = status === "running";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isEnabled || !content.trim() || submitting) return;

    setSubmitting(true);
    try {
      await fetch(`/api/scans/${scanId}/inject-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      setContent("");
    } catch {
      // Network error — silently ignore
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 border-t border-border bg-surface px-4 py-3"
    >
      <Input
        type="text"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Send investigation instructions…"
        disabled={!isEnabled || submitting}
        className="flex-1"
        aria-label="Investigation prompt"
      />
      <Button
        type="submit"
        variant="default"
        disabled={!isEnabled || submitting}
        aria-label="Send"
      >
        Send
      </Button>
    </form>
  );
}
