import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getProjectById } from "@/lib/repos/projects.repo";
import { listScansByProject } from "@/lib/repos/scans.repo";
import { countFindings } from "@/lib/repos/findings.repo";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScanStatusPoller } from "@/components/ui/ScanStatusPoller";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const project = getProjectById(db, id);

  if (!project) notFound();

  const allScans = listScansByProject(db, id);
  const runningScans = allScans.filter((s) => s.status === "running");
  const scans = allScans.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
  });

  const totalFindings = scans.reduce((sum, s) => sum + countFindings(db, s.id), 0);

  return (
    <div className="space-y-6">
      <ScanStatusPoller hasRunning={runningScans.length > 0} />
      {/* Back */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-fg/50 hover:text-fg transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0l7 7m-7-7l7-7" />
        </svg>
        Projects
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">{project.name}</h1>
          <p className="mt-1 font-mono text-xs text-fg/40 break-all">{project.sourceRef}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge size="sm">{project.sourceKind}</Badge>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg/60">
        <span><span className="font-semibold text-fg">{scans.length}</span> {scans.length === 1 ? "scan" : "scans"}</span>
        <span><span className="font-semibold text-fg">{totalFindings}</span> {totalFindings === 1 ? "finding" : "findings"}</span>
        {runningScans.length > 0 && (
          <span className="flex items-center gap-1.5 text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-medium">
              {runningScans.length} {runningScans.length === 1 ? "scan running" : "scans running"}
            </span>
          </span>
        )}
        <span className="text-fg/30">Created {new Date(project.createdAt).toLocaleDateString()}</span>
      </div>

      {/* Scans list */}
      {scans.length === 0 ? (
        <Card className="px-4">
          <div className="flex flex-col items-center py-8 text-center gap-3">
            <p className="text-sm text-fg/50">No scans yet for this project.</p>
            <Link href="/scans/new">
              <Button variant="primary" size="md">Start a scan</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-fg/60 uppercase tracking-wide">Scans</h2>
          {scans.map((scan) => {
            const fc = countFindings(db, scan.id);
            return (
              <Card key={scan.id} className="px-4 transition-shadow hover:ring-2 hover:ring-accent/20 cursor-pointer">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {scan.status === "running" ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                        <span className="text-xs text-accent font-medium">Running</span>
                      </div>
                    ) : (
                      <Badge status={scan.status as "pending" | "running" | "done" | "failed" | "cancelled"} size="sm">
                        {scan.status}
                      </Badge>
                    )}
                    <span className="text-xs font-mono text-fg/40 shrink-0">v{scan.version}</span>
                    {scan.status === "running" && scan.stage && (
                      <span className="truncate text-xs text-fg/50">{scan.stage}</span>
                    )}
                    {scan.status !== "running" && scan.prompt && (
                      <span className="truncate text-xs text-fg/50 italic max-w-xs">
                        &ldquo;{scan.prompt}&rdquo;
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-xs text-fg/50 tabular-nums">
                    {fc > 0 && (
                      <span className="font-semibold text-fg">{fc} {fc === 1 ? "finding" : "findings"}</span>
                    )}
                    {scan.finishedAt && (
                      <span>{new Date(scan.finishedAt).toLocaleDateString()}</span>
                    )}
                    <div className="flex gap-1.5">
                      <Link href={`/scans/${scan.id}`}>
                        <Button variant="secondary" size="sm">View</Button>
                      </Link>
                      {scan.status === "done" && fc > 0 && (
                        <Link href={`/reports/${scan.id}`}>
                          <Button variant="secondary" size="sm">Report</Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
