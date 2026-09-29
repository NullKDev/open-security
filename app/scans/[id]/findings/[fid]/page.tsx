import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getFindingById } from "@/lib/repos/findings.repo";
import { readConfig } from "@/lib/config/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FindingActions } from "./FindingActions";
import { VerdictBadge } from "@/components/ui/hunt/VerdictBadge";
import { SecretTimelineView } from "@/components/ui/timeline/SecretTimelineView";
import { CollaborationPanel } from "@/components/findings/CollaborationPanel";
import { ExportPanel } from "@/components/findings/ExportPanel";

export default async function FindingDetailPage({
  params,
}: {
  params: Promise<{ id: string; fid: string }>;
}) {
  const { fid } = await params;
  const db = getDb();
  const finding = getFindingById(db, fid);
  const config = readConfig();

  if (!finding) {
    notFound();
  }

  const dataFlowStr = finding.dataFlow != null ? JSON.stringify(finding.dataFlow, null, 2) : null;
  const evidenceStr = finding.evidenceHistory != null ? JSON.stringify(finding.evidenceHistory, null, 2) : null;

  const severityLabel = finding.severity as
    | "critical"
    | "high"
    | "medium"
    | "low"
    | "info";

  const verdict = (finding as Record<string, unknown>).verdict as
    | "exposed"
    | "not-exposed"
    | "indeterminate"
    | null
    | undefined;

  const isSecretFinding =
    finding.detector?.toLowerCase().includes("secret") ||
    finding.detector?.toLowerCase().includes("gitleaks") ||
    finding.detector?.toLowerCase().includes("trufflehog");

  return (
    <div className="space-y-6">
      {/* Back link */}
      <a
        href={`/scans/${finding.scanId}`}
        className="inline-flex items-center gap-1.5 text-sm text-fg/50 hover:text-fg transition-colors duration-150"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 12H5m0 0l7 7m-7-7l7-7"
          />
        </svg>
        Back to scan
      </a>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Badge severity={severityLabel} size="md">
            {finding.severity}
          </Badge>
          <span className="text-sm text-fg/50">{finding.detector}</span>
          {verdict && <VerdictBadge verdict={verdict} />}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">
          {finding.title}
        </h1>
        <p className="mt-1 text-sm text-fg/50 font-mono">
          {finding.locationPath}:{finding.locationLineStart}
          {finding.locationLineEnd && finding.locationLineEnd !== finding.locationLineStart
            ? `-${finding.locationLineEnd}`
            : ""}
        </p>
      </div>

      {/* Description */}
      <Card className="px-4">
        <Card.Header title="Description" />
        <p className="text-sm leading-relaxed text-fg/80">
          {finding.description || "No description provided."}
        </p>
      </Card>

      {/* Data Flow */}
      {dataFlowStr && (
        <Card className="px-4">
          <Card.Header title="Data Flow" />
          <pre className="overflow-x-auto rounded-md border border-border bg-bg p-4 text-xs font-mono leading-relaxed text-fg/80">
            {dataFlowStr}
          </pre>
        </Card>
      )}

      {/* Evidence */}
      {evidenceStr && (
        <Card className="px-4">
          <Card.Header title="Evidence" />
          <pre className="overflow-x-auto rounded-md border border-border bg-bg p-4 text-xs font-mono leading-relaxed text-fg/80">
            {evidenceStr}
          </pre>
        </Card>
      )}

      {/* Suggested Fix */}
      {finding.patchDiff && (
        <Card className="px-4">
          <Card.Header
            title="Suggested Fix"
            subtitle={
              finding.patchGeneratedAt
                ? `Generated ${new Date(finding.patchGeneratedAt).toLocaleString()}`
                : "Generated during scan"
            }
          />
          <p className="text-sm leading-relaxed text-fg/80">
            {finding.patchDiff}
          </p>
          {finding.patchExplanation && (
            <p className="mt-2 text-xs text-fg/50">
              Strategy: {finding.patchExplanation}
            </p>
          )}
        </Card>
      )}

      {/* Secret Timeline (shown only for secret-type findings) */}
      {isSecretFinding && (
        <Card className="px-4">
          <Card.Header title="Exposure Timeline" />
          {/* @ts-expect-error RSC async component */}
          <SecretTimelineView findingId={fid} />
        </Card>
      )}

      {/* Actions */}
      <Card className="px-4">
        <Card.Header title="Actions" />
        <FindingActions
          findingId={fid}
          scanId={finding.scanId}
          isFalsePositive={finding.fpFiltered}
          hasPatch={!!finding.patchDiff}
        />
      </Card>

      {/* v1.0: Collaboration + Export panels (guarded by features.collaboration) */}
      {config.features.collaboration && (
        <div className="grid gap-4 md:grid-cols-2">
          <CollaborationPanel findingId={fid} />
          <ExportPanel
            findingId={fid}
            scanId={finding.scanId}
            lastExportError={(finding as Record<string, unknown>).lastExportError as string | null}
          />
        </div>
      )}
    </div>
  );
}
