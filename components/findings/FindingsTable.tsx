"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export interface FindingRow {
  id: string;
  scanId: string;
  severity: string;
  title: string;
  detector: string;
  locationPath: string;
  locationLineStart: number;
  createdAt: string;
}

type SortField = "severity" | "title" | "detector" | "locationPath" | "createdAt";
type SortDir = "asc" | "desc";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function FindingsTable({
  findings,
  scanId,
}: {
  findings: FindingRow[];
  scanId: string;
}) {
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortField) return findings;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...findings].sort((a, b) => {
      if (sortField === "severity") {
        return ((SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)) * dir;
      }
      const av = String(a[sortField] ?? "");
      const bv = String(b[sortField] ?? "");
      return av.localeCompare(bv) * dir;
    });
  }, [findings, sortField, sortDir]);

  function sortIndicator(field: SortField): string {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  return (
    <Card padding="sm" className="overflow-x-auto">
      {findings.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-fg/50">No findings to display.</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {(
                [
                  { field: "severity" as const, label: "Severity" },
                  { field: "title" as const, label: "Title" },
                  { field: "detector" as const, label: "Detector" },
                  { field: "locationPath" as const, label: "Location" },
                ] as const
              ).map(({ field, label }) => (
                <th
                  key={field}
                  className="px-3 py-2.5 text-left text-xs font-medium text-fg/50 uppercase tracking-wider cursor-pointer select-none hover:text-fg transition-colors"
                  onClick={() => handleSort(field)}
                >
                  {label}
                  {sortIndicator(field)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr
                key={f.id}
                className="border-b border-border/50 hover:bg-surface transition-colors cursor-pointer"
                onClick={() => {
                  window.location.href = `/scans/${scanId}/findings/${f.id}`;
                }}
              >
                <td className="px-3 py-2.5">
                  <Badge
                    severity={f.severity as "critical" | "high" | "medium" | "low" | "info"}
                    size="sm"
                  >
                    {f.severity}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 font-medium text-fg max-w-[300px] truncate">
                  {f.title}
                </td>
                <td className="px-3 py-2.5 text-fg/60">{f.detector}</td>
                <td className="px-3 py-2.5 text-fg/50 font-mono text-xs">
                  {f.locationPath}:{f.locationLineStart}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
