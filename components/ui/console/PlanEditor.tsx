"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface PlanStep {
  index: number;
  content: string;
  status: string;
}

interface PlanEditorProps {
  /** The scan ID whose plan is being edited. */
  scanId: string;
  /** List of plan steps to display and edit. */
  steps: PlanStep[];
}

/**
 * Editable plan step list for investigation console.
 *
 * - Renders each step with an Edit button
 * - Click Edit → shows Textarea with current content
 * - Save button → POST `/api/scans/${scanId}/edit-plan` with `{ stepIndex, newContent }`
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function PlanEditor({ scanId, steps }: PlanEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function startEdit(step: PlanStep) {
    setEditingIndex(step.index);
    setEditContent(step.content);
  }

  async function handleSave() {
    if (editingIndex === null || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/scans/${scanId}/edit-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex: editingIndex, newContent: editContent }),
      });
    } catch {
      // Network error — silently ignore
    } finally {
      setSubmitting(false);
      setEditingIndex(null);
      setEditContent("");
    }
  }

  function handleCancel() {
    setEditingIndex(null);
    setEditContent("");
  }

  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div
          key={step.index}
          className="rounded-md border border-border bg-surface p-3 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-mono text-fg/50">Step {step.index + 1}</span>
            <span className="text-[10px] uppercase tracking-wide text-fg/40">{step.status}</span>
          </div>

          {editingIndex === step.index ? (
            <div className="space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                disabled={submitting}
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={submitting}
                  aria-label="Cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleSave}
                  disabled={submitting}
                  aria-label="Save"
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-fg/80">{step.content}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => startEdit(step)}
                aria-label="Edit"
              >
                Edit
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
