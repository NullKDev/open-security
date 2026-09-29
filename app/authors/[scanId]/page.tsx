import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listAuthorsByScan } from "@/lib/repos/authors.repo";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AuthorsPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const db = getDb();
  const authors = listAuthorsByScan(db, scanId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Authors</h1>
        <Link
          href={`/scans/${scanId}`}
          className="text-sm text-fg/50 hover:text-fg transition-colors"
        >
          Back to scan
        </Link>
      </div>

      {authors.length === 0 ? (
        <Card padding="lg">
          <div className="py-8 text-center">
            <p className="text-sm text-fg/50">No authors analyzed yet.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {authors.map((author) => {
            const flags = Array.isArray(author.anomalyFlags)
              ? (author.anomalyFlags as string[])
              : [];
            return (
              <Card key={`${author.scanId}-${author.email}`} className="px-4">
                <div className="flex flex-col gap-2">
                  <h3 className="font-semibold text-fg">
                    {author.name || author.email}
                  </h3>
                  <p className="text-xs text-fg/50 font-mono">
                    {author.email}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm tabular-nums font-medium text-fg">
                      {author.commitCount}
                    </span>
                    <span className="text-xs text-fg/50">commits</span>
                  </div>
                  {flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {flags.map((flag) => (
                        <Badge key={flag} severity="medium" size="sm">
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
