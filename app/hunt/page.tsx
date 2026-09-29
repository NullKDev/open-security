"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VerdictBadge } from "@/components/ui/hunt/VerdictBadge";
import { Card } from "@/components/ui/card";

type Verdict = "exposed" | "not-exposed" | "indeterminate";

interface HuntResult {
  id: string;
  status: string;
  verdict: Verdict | null;
}

const CVE_PATTERN = /^(CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/i;

/**
 * Hunt page — allows scanning for a specific CVE/GHSA advisory.
 *
 * - CVE/GHSA ID input with client-side validation
 * - Submit → POST `/api/scans/hunt`
 * - Shows VerdictBadge when scan completes with verdict
 * - "Open as finding" button disabled when verdict is `'not-exposed'`
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export default function HuntPage() {
  const [cveId, setCveId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HuntResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = cveId.trim();
    if (!trimmed) {
      setError("Please enter a CVE or GHSA ID.");
      return;
    }

    if (!CVE_PATTERN.test(trimmed)) {
      setError("Invalid format. Use CVE-YYYY-NNNNN or GHSA-xxxx-xxxx-xxxx.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/scans/hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cveId: trimmed }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error?.message ?? "Failed to start hunt.");
        return;
      }

      setResult(data.data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const verdict = result?.verdict ?? null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-fg">Hunt</h1>
      <p className="text-sm text-fg/50">
        Check if a CVE or GHSA advisory affects this repository.
      </p>

      <Card className="px-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg/80" htmlFor="cve-input">
              CVE / GHSA ID
            </label>
            <Input
              id="cve-input"
              type="text"
              value={cveId}
              onChange={(e) => setCveId(e.target.value)}
              placeholder="CVE-2024-12345 or GHSA-xxxx-xxxx-xxxx"
              disabled={loading}
              className="w-full"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" variant="default" disabled={loading} aria-label="Hunt">
              {loading ? "Hunting…" : "Hunt"}
            </Button>
          </div>
        </form>
      </Card>

      {result && verdict && (
        <Card className="px-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-fg">Result</span>
              <VerdictBadge verdict={verdict} />
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="default"
                disabled={verdict === "not-exposed"}
                aria-label="Open as finding"
              >
                Open as finding
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
