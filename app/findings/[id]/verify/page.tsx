import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getFindingById } from "@/lib/repos/findings.repo";
import { getLatestProof } from "@/lib/repos/fix-proofs.repo";
import { ProofOfFixBadge } from "@/components/findings/ProofOfFixBadge";
import { DualDiffViewer } from "@/components/findings/DualDiffViewer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProvePageClient } from "./ProvePageClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Fix & Prove verify page — RSC.
 *
 * Shows the finding summary, triad step overview, and current proof-of-fix
 * status. A "Start Fix & Prove" button triggers POST /api/findings/{id}/verify
 * and polling is handled by the client sub-component (REQ-FP-01, REQ-FP-05).
 *
 * The trigger button is disabled when no patch_diff exists on the finding.
 *
 * @param params - Route params with finding ID
 */
export default async function VerifyPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();

  const finding = getFindingById(db, id);
  if (!finding) notFound();

  const latestProof = getLatestProof(db, id);

  const hasPatch = Boolean((finding as Record<string, unknown>).patchDiff);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-fg">
          Fix &amp; Prove
        </h1>
        <p className="mt-1 text-sm text-fg/50">
          Verify the fix for this finding using the PatchEval triad.
        </p>
      </div>

      {/* Finding summary */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base font-semibold">{finding.title}</CardTitle>
            <Badge variant="outline" className="capitalize text-xs">
              {finding.severity}
            </Badge>
            {finding.status && (
              <Badge variant="secondary" className="text-xs">
                {finding.status}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {finding.location && (
            <p className="font-mono text-xs text-fg/50">{finding.location}</p>
          )}
        </CardContent>
      </Card>

      {/* Triad steps overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Triad Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                1
              </span>
              <span className="text-fg/70">Unit test suite (post-patch)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                2
              </span>
              <span className="text-fg/70">Regression test authored — fails pre-patch</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                3
              </span>
              <span className="text-fg/70">Vuln run passes post-patch</span>
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Client component: trigger button + live polling */}
      <ProvePageClient findingId={id} hasPatch={hasPatch} />

      {/* Proof result — shown when a proof exists */}
      {latestProof && (
        <div className="space-y-4">
          <ProofOfFixBadge
            proof={{
              outcome: latestProof.outcome as "verified-fixed" | "fix-unverified",
              unitTestPassed: latestProof.unitTestPassed,
              vulRunPassedPre: latestProof.vulRunPassedPre,
              vulRunPassedPost: latestProof.vulRunPassedPost,
              regressionTestPath: latestProof.regressionTestPath,
              prePatchOutput: latestProof.prePatchOutput,
              postPatchOutput: latestProof.postPatchOutput,
              completedAt: latestProof.completedAt,
              failureReason: latestProof.failureReason as
                | "no-patch"
                | "unit-test-baseline-red"
                | "regression-test-invalid"
                | "vul-not-eliminated"
                | "unit-test-failed"
                | "agent-error"
                | "timeout"
                | null,
            }}
          />

          {(latestProof.patchDiff || latestProof.regressionTestDiff) && (
            <DualDiffViewer
              fixDiff={latestProof.patchDiff ?? ""}
              regressionTestDiff={latestProof.regressionTestDiff ?? ""}
              regressionTestPath={latestProof.regressionTestPath ?? ""}
            />
          )}
        </div>
      )}
    </div>
  );
}
