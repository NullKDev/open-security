import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/lib/db/client";
import { listProjects } from "@/lib/repos/projects.repo";
import { listScansByProject } from "@/lib/repos/scans.repo";
import { countFindings } from "@/lib/repos/findings.repo";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const FORMATS = [
  { fmt: "json", label: "JSON", desc: "Machine-readable, full detail" },
  { fmt: "md", label: "Markdown", desc: "Readable report with finding details" },
  { fmt: "sarif", label: "SARIF", desc: "Static Analysis Results Interchange Format 2.1.0" },
  { fmt: "csv", label: "CSV", desc: "Spreadsheet-ready table" },
] as const;

export default async function ReportsPage() {
  const t = await getTranslations("reports");
  const db = getDb();
  const projects = listProjects(db);

  const scansWithProject = projects.flatMap((p) =>
    listScansByProject(db, p.id)
      .filter((s) => s.status === "done")
      .map((scan) => ({
        ...scan,
        projectName: p.name,
        projectId: p.id,
        findingCount: countFindings(db, scan.id),
      })),
  );

  scansWithProject.sort((a, b) => {
    const aT = a.finishedAt ?? "";
    const bT = b.finishedAt ?? "";
    return bT.localeCompare(aT);
  });

  if (scansWithProject.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-4 rounded-full bg-surface p-4">
          <svg className="h-8 w-8 text-fg/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-fg">{t("empty.title")}</h2>
        <p className="mt-1 max-w-xs text-sm text-fg/60">
          {t("empty.description")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight text-fg">{t("title")}</h1>

      <div className="space-y-4">
        {scansWithProject.map((scan) => (
          <Card key={scan.id} padding="md">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-fg truncate">{scan.projectName}</h3>
                  <Badge size="sm">{scan.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-fg/50">
                  {scan.findingCount} {scan.findingCount === 1 ? "finding" : "findings"}
                  {scan.finishedAt ? ` · ${new Date(scan.finishedAt).toLocaleDateString()}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Link
                  href={`/reports/${scan.id}`}
                  className="rounded-md bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
                >
                  View
                </Link>
                {FORMATS.map(({ fmt, label, desc }) => (
                  <a
                    key={fmt}
                    href={`/api/reports/${scan.id}?format=${fmt}`}
                    className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-fg/60 transition-colors hover:bg-surface hover:text-fg"
                    title={desc}
                    download={`${scan.projectName}-${fmt}.${fmt === "md" ? "md" : fmt === "json" || fmt === "sarif" ? "json" : "csv"}`}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
