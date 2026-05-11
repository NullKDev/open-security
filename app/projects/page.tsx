import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listProjects } from "@/lib/repos/projects.repo";
import { listScansByProject } from "@/lib/repos/scans.repo";
import { countFindings } from "@/lib/repos/findings.repo";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScanStatusPoller } from "@/components/ui/ScanStatusPoller";

/**
 * Projects grid — lists all tracked projects with scan status and finding counts.
 * Extracted from the old dashboard (app/page.tsx) as part of route restructuring.
 */
export default async function ProjectsPage() {
  const db = getDb();
  const projects = listProjects(db);

  if (projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 lg:p-8 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-fg">open-security</h1>
        <p className="mt-2 max-w-md text-sm text-fg/50 leading-relaxed">
          Blue Team security workbench. Point it at a repository or folder — it
          clones, scans with classical tools + LLM analysis, finds
          vulnerabilities, traces secrets through git history, and generates
          reports.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-fg/30">
          <span>Local-first</span>
          <span>·</span>
          <span>No login</span>
          <span>·</span>
          <span>No telemetry</span>
        </div>
        <Button variant="primary" className="mt-6" asChild>
          <Link href="/queue">Go to Queue</Link>
        </Button>
      </div>
    );
  }

  const allScans = projects.flatMap((p) => listScansByProject(db, p.id));
  const anyRunning = allScans.some((s) => s.status === "running");

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <ScanStatusPoller hasRunning={anyRunning} />
      <h1 className="text-2xl font-bold tracking-tight text-fg">Projects</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => {
          const scans = listScansByProject(db, project.id);
          const totalFindings = scans.reduce(
            (sum, s) => sum + countFindings(db, s.id),
            0
          );
          const runningScans = scans.filter((s) => s.status === "running");
          const lastScan = scans.sort((a, b) => {
            const aT = a.startedAt ?? "";
            const bT = b.startedAt ?? "";
            return bT.localeCompare(aT);
          })[0];

          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group block outline-none focus-visible:ring-2 focus-visible:ring-accent/30 rounded-lg"
            >
              <Card className="hover:bg-surface-hover transition-colors">
                <div className="flex flex-col gap-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-fg leading-snug truncate">
                      {project.name}
                    </h3>
                    <Badge variant="outline">{project.sourceKind}</Badge>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-fg/50 tabular-nums">
                    <span>
                      {scans.length} {scans.length === 1 ? "scan" : "scans"}
                    </span>
                    {totalFindings > 0 && (
                      <span>
                        {totalFindings}{" "}
                        {totalFindings === 1 ? "finding" : "findings"}
                      </span>
                    )}
                  </div>

                  {runningScans.length > 0 ? (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse shrink-0" />
                      <span className="text-[11px] text-accent font-medium truncate">
                        {runningScans.length > 1
                          ? `${runningScans.length} scans running`
                          : (runningScans[0].stage ?? "Scanning…")}
                      </span>
                    </div>
                  ) : lastScan ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline">{lastScan.status}</Badge>
                      {lastScan.startedAt && (
                        <span className="text-[11px] text-fg/30 tabular-nums">
                          {new Date(lastScan.startedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
