"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface FindingActionsProps {
  findingId: string;
  scanId: string;
  isFalsePositive: boolean;
  hasPatch: boolean;
}

export function FindingActions({
  findingId,
  scanId,
  isFalsePositive,
  hasPatch,
}: FindingActionsProps) {
  const router = useRouter();
  const [marking, setMarking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [patching, setPatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMarkFp = async () => {
    setMarking(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fpFiltered: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || "Failed to update finding.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setMarking(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || "Failed to delete finding.");
        return;
      }
      router.push(`/scans/${scanId}`);
    } catch {
      setError("Network error.");
    } finally {
      setDeleting(false);
    }
  };

  const handleGeneratePatch = async () => {
    setPatching(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/generate-patch`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || "Failed to generate patch.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setPatching(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="secondary"
          size="md"
          loading={marking}
          disabled={isFalsePositive}
          onClick={handleMarkFp}
        >
          {isFalsePositive ? "Marked as FP" : "Mark as False Positive"}
        </Button>
        <Button
          variant="secondary"
          size="md"
          loading={patching}
          onClick={handleGeneratePatch}
        >
          {hasPatch ? "Re-generate Patch" : "Generate Patch"}
        </Button>
        <Button
          variant="danger"
          size="md"
          loading={deleting}
          onClick={handleDelete}
        >
          Delete
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      )}
    </div>
  );
}
