import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listCommitsByScan } from "@/lib/repos/commits.repo";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const db = getDb();
  const commits = listCommitsByScan(db, scanId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Timeline</h1>
        <Link
          href={`/scans/${scanId}`}
          className="text-sm text-fg/50 hover:text-fg transition-colors"
        >
          Back to scan
        </Link>
      </div>

      {commits.length === 0 ? (
        <Card padding="lg">
          <div className="py-8 text-center">
            <p className="text-sm text-fg/50">No commits analyzed yet.</p>
          </div>
        </Card>
      ) : (
        <div className="relative pl-8 border-l-2 border-border space-y-6">
          {commits.map((commit) => (
            <div key={commit.sha} className="relative">
              {/* Dot */}
              <div
                className={`absolute -left-[2.15rem] top-1 h-3 w-3 rounded-full border-2 border-bg ${
                  commit.riskScore && commit.riskScore > 0.5
                    ? "bg-danger"
                    : "bg-success"
                }`}
              />

              <Card padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-fg truncate">
                      {commit.message || "No message"}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-fg/50">
                      <span>{commit.authorName || "Unknown"}</span>
                      <span>·</span>
                      <span className="font-mono text-[11px]">
                        {commit.sha.slice(0, 7)}
                      </span>
                      {commit.authoredAt && (
                        <>
                          <span>·</span>
                          <span>
                            {new Date(commit.authoredAt).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {commit.riskScore != null && commit.riskScore > 0.5 && (
                    <Badge severity="high" size="sm">
                      Suspicious
                    </Badge>
                  )}
                </div>

                {commit.filesChanged != null && (
                  <div className="mt-3 flex gap-4 text-xs text-fg/50">
                    <span>{commit.filesChanged} files</span>
                    {commit.insertions != null && (
                      <span className="text-success">
                        +{commit.insertions}
                      </span>
                    )}
                    {commit.deletions != null && (
                      <span className="text-danger">
                        -{commit.deletions}
                      </span>
                    )}
                  </div>
                )}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
