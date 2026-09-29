"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FpBankReOpenButtonProps {
  /** The finding ID used to call DELETE /api/findings/[id]/dismiss */
  findingId: string;
  /** The dismissal record ID (for optimistic UI identification) */
  dismissalId: string;
}

/**
 * Button that re-opens a dismissed finding by calling DELETE on its dismiss route.
 * On success, the row is removed and the queue refreshes on next load.
 *
 * @param findingId - Finding ID for the dismiss API route
 * @param dismissalId - Dismissal ID (used for UI identification only)
 */
export function FpBankReOpenButton({
  findingId,
}: FpBankReOpenButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReOpen() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/dismiss`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          (body as { error?: { message?: string } }).error?.message ??
            "Failed to re-open finding",
        );
        return;
      }
      // Refresh the server component to reflect the removal
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleReOpen}
        disabled={loading}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg/60 hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-50"
      >
        {loading ? "Reopening…" : "Re-open"}
      </button>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
