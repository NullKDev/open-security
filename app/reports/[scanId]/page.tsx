import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getScanById } from "@/lib/repos/scans.repo";
import { getProjectById } from "@/lib/repos/projects.repo";
import { listFindings } from "@/lib/repos/findings.repo";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

function severityRank(s: string): number {
  return SEVERITY_ORDER.indexOf(s as (typeof SEVERITY_ORDER)[number]);
}

export default async function ReportViewPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const db = getDb();
  const scan = getScanById(db, scanId);
  if (!scan) notFound();

  const project = getProjectById(db, scan.projectId);

  const { findings } = listFindings(db, scanId, { limit: 500, fpFiltered: false });

  const sorted = [...findings].sort((a, b) => {
    const sr = severityRank(a.severity) - severityRank(b.severity);
    return sr !== 0 ? sr : a.title.localeCompare(b.title);
  });

  const counts = SEVERITY_ORDER.reduce(
    (acc, s) => {
      acc[s] = findings.filter((f) => f.severity === s).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  const FORMATS = [
    { fmt: "json", label: "JSON" },
    { fmt: "md", label: "MD" },
    { fmt: "sarif", label: "SARIF" },
    { fmt: "csv", label: "CSV" },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/reports"
        className="inline-flex items-center gap-1.5 text-sm text-fg/50 hover:text-fg transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0l7 7m-7-7l7-7" />
        </svg>
        Reports
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">
            {project?.name ?? "Report"}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs font-mono text-fg/40">v{scan.version}</span>
            {scan.finishedAt && (
              <span className="text-xs text-fg/40">
                {new Date(scan.finishedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {FORMATS.map(({ fmt, label }) => (
            <a
              key={fmt}
              href={`/api/reports/${scanId}?format=${fmt}`}
              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-fg/60 transition-colors hover:bg-surface hover:text-fg"
              download
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      {/* Severity summary */}
      <div className="flex flex-wrap gap-2">
        {SEVERITY_ORDER.map((s) =>
          counts[s] > 0 ? (
            <div
              key={s}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5"
            >
              <Badge severity={s} size="sm">{s}</Badge>
              <span className="text-sm font-semibold tabular-nums text-fg">{counts[s]}</span>
            </div>
          ) : null,
        )}
        {findings.length === 0 && (
          <p className="text-sm text-fg/50">No findings — clean scan.</p>
        )}
      </div>

      {/* Findings list */}
      {sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((f) => (
            <Card key={f.id} className="px-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  <Badge severity={f.severity as "critical" | "high" | "medium" | "low" | "info"} size="sm">
                    {f.severity}
                  </Badge>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/scans/${scanId}/findings/${f.id}`}
                      className="font-semibold text-fg hover:text-accent transition-colors leading-snug"
                    >
                      {f.title}
                    </Link>
                    <span className="shrink-0 text-xs text-fg/30 font-mono">{f.detector}</span>
                  </div>
                  <p className="text-sm text-fg/60 leading-relaxed line-clamp-2">
                    {f.description}
                  </p>
                  {f.locationPath && (
                    <p className="text-xs font-mono text-fg/40">
                      {f.locationPath}
                      {f.locationLineStart > 0 ? `:${f.locationLineStart}` : ""}
                    </p>
                  )}
                  {f.validationRationale && (
                    <p className="mt-1 text-xs text-fg/50 italic border-l-2 border-border pl-2">
                      {f.validationRationale}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
