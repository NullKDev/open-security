"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface ScanStatusPollerProps {
  /** True when at least one scan is currently running. Polling stops when false. */
  hasRunning: boolean;
  /** Polling interval in ms. Default 5000. */
  intervalMs?: number;
}

/**
 * Invisible component that refreshes the page via router.refresh() while
 * scans are running. Mounts only in pages that have active scans.
 */
export function ScanStatusPoller({ hasRunning, intervalMs = 5000 }: ScanStatusPollerProps) {
  const router = useRouter();

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [hasRunning, intervalMs, router]);

  return null;
}
