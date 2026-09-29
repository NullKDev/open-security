import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getFindingById } from "@/lib/repos/findings.repo";
import { getRegressionLineage } from "@/lib/repos/regressions.repo";
import { RegressionBadge } from "@/components/findings/RegressionBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Regression lineage page — RSC.
 *
 * Shows the regression finding alongside the original finding it regressed from,
 * with branch details and detection timeline.
 *
 * Reads from finding_regressions table via getRegressionLineage() and
 * getFindingById() for both the regression and original findings.
 *
 * @param params - Route params with finding ID (the regression finding's ID)
 */
export default async function RegressionPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();

  const finding = getFindingById(db, id);
  if (!finding) notFound();

  const lineage = getRegressionLineage(db, id);

  const originalFinding = lineage
    ? getFindingById(db, lineage.originalFindingId)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-fg">
          Regression Lineage
        </h1>
        <p className="mt-1 text-sm text-fg/50">
          This finding is a regression of a previously fixed vulnerability.
        </p>
      </div>

      {/* Regression finding */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <RegressionBadge />
            <CardTitle className="text-base font-semibold">{finding.title}</CardTitle>
            <Badge variant="outline" className="capitalize text-xs">
              {finding.severity}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-1">
          <p className="text-xs text-fg/50">
            <span className="font-medium text-fg/60">Finding ID: </span>
            <span className="font-mono">{finding.id}</span>
          </p>
          {finding.location && (
            <p className="font-mono text-xs text-fg/50">{finding.location}</p>
          )}
          <p className="text-xs">
            <span className="text-fg/50">Status: </span>
            <Badge variant="secondary" className="text-xs">{finding.status}</Badge>
          </p>
        </CardContent>
      </Card>

      {/* Arrow */}
      <div className="flex items-center justify-center text-fg/30 text-xs gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
        </svg>
        regressed from
      </div>

      {/* Original finding */}
      {originalFinding ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-success/30 text-success text-xs">
                Original Fix
              </Badge>
              <CardTitle className="text-base font-semibold">{originalFinding.title}</CardTitle>
              <Badge variant="outline" className="capitalize text-xs">
                {originalFinding.severity}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            <p className="text-xs text-fg/50">
              <span className="font-medium text-fg/60">Finding ID: </span>
              <span className="font-mono">{originalFinding.id}</span>
            </p>
            {originalFinding.location && (
              <p className="font-mono text-xs text-fg/50">{originalFinding.location}</p>
            )}
            <p className="text-xs">
              <span className="text-fg/50">Status: </span>
              <Badge variant="secondary" className="text-xs">{originalFinding.status}</Badge>
            </p>
            <Link
              href={`/findings/${originalFinding.id}/verify`}
              className="inline-block mt-2 text-xs text-accent hover:underline"
            >
              View proof of fix →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-fg/40">
            Original finding not found.
          </CardContent>
        </Card>
      )}

      {/* Timeline / lineage details */}
      {lineage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {lineage.regressionCommitSha && (
              <div className="flex items-start gap-2">
                <span className="text-fg/40 shrink-0 w-28">Commit SHA</span>
                <span className="font-mono text-xs">{lineage.regressionCommitSha}</span>
              </div>
            )}
            <div className="flex items-start gap-2">
              <span className="text-fg/40 shrink-0 w-28">Detected at</span>
              <span className="text-xs">{formatDate(lineage.detectedAt)}</span>
            </div>
            {lineage.originalBranchId && (
              <div className="flex items-start gap-2">
                <span className="text-fg/40 shrink-0 w-28">Branch ID</span>
                <span className="font-mono text-xs">{lineage.originalBranchId}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
