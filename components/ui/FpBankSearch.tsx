"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface FpBankSearchProps {
  /** Current search value from URL params (for SSR hydration) */
  defaultValue?: string;
}

/**
 * Search input for the FP bank (dismissed findings) tab.
 *
 * Debounces user input and updates the URL's `search` query param after 300ms,
 * triggering a server-side FTS5 search via page re-render.
 *
 * @param defaultValue - Initial search value from URL search params
 */
export function FpBankSearch({ defaultValue = "" }: FpBankSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "dismissed");
      if (value.trim().length > 0) {
        params.set("search", value.trim());
      } else {
        params.delete("search");
      }
      router.replace(`/findings?${params.toString()}`);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, router, searchParams]);

  return (
    <div className="relative">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/40"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search dismissed findings…"
        className="w-full rounded-md border border-border bg-bg py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg/40 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
