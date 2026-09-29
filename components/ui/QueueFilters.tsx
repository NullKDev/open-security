"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
type Severity = (typeof SEVERITIES)[number];

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  info: "bg-gray-400",
};

const DEBOUNCE_MS = 300;

/**
 * Client component that manages queue filter state in URL search params.
 * Severity is a multi-select; KEV-only is a toggle; search is debounced.
 *
 * All state lives in the URL so the server component re-renders with fresh data.
 */
export function QueueFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawSeverity = searchParams.get("severity") ?? "";
  const activeSeverities = rawSeverity
    ? (rawSeverity.split(",").filter(Boolean) as Severity[])
    : [];
  const kevOnly = searchParams.get("kevOnly") === "true";
  const initialSearch = searchParams.get("search") ?? "";

  const [searchInput, setSearchInput] = useState(initialSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      // Reset cursor on any filter change
      params.delete("cursor");
      router.replace(`/queue?${params.toString()}`);
    },
    [router, searchParams]
  );

  function toggleSeverity(sev: Severity) {
    const next = activeSeverities.includes(sev)
      ? activeSeverities.filter((s) => s !== sev)
      : [...activeSeverities, sev];
    updateParams({ severity: next.length > 0 ? next.join(",") : null });
  }

  function toggleKev() {
    updateParams({ kevOnly: kevOnly ? null : "true" });
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ search: value.trim() || null });
    }, DEBOUNCE_MS);
  }

  // Sync local input when URL changes externally
  useEffect(() => {
    setSearchInput(searchParams.get("search") ?? "");
  }, [searchParams]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Severity multi-select */}
      <div className="flex items-center gap-1">
        {SEVERITIES.map((sev) => {
          const active = activeSeverities.includes(sev);
          return (
            <button
              key={sev}
              type="button"
              onClick={() => toggleSeverity(sev)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-fg/50 hover:border-accent/40 hover:text-fg"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${SEVERITY_DOT[sev]}`}
                aria-hidden
              />
              {sev}
            </button>
          );
        })}
      </div>

      {/* KEV toggle */}
      <button
        type="button"
        onClick={toggleKev}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
          kevOnly
            ? "border-red-500 bg-red-50 text-red-600"
            : "border-border text-fg/50 hover:border-red-400 hover:text-fg"
        }`}
      >
        <span className="font-bold">KEV</span>
        only
      </button>

      {/* Search input */}
      <input
        type="search"
        value={searchInput}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="Search findings…"
        className="h-7 rounded-md border border-input bg-input/20 px-2 text-xs/relaxed text-fg outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
      />
    </div>
  );
}
