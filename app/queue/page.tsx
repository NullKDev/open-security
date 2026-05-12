import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/lib/db/client";
import { getQueue, getQueueStats } from "@/lib/repos/queue.repo";
import { getBranchByFindingId } from "@/lib/repos/finding-branches.repo";
import {
  listActiveDismissals,
  searchDismissals,
  type DismissalDTO,
} from "@/lib/repos/finding-dismissals.repo";
import { QueueItem } from "@/components/ui/QueueItem";
import { QueueFilters } from "@/components/ui/QueueFilters";
import { FpBankReOpenButton } from "@/components/ui/FpBankReOpenButton";
import { FpBankSearch } from "@/components/ui/FpBankSearch";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps an fp_type value to a human-readable label.
 *
 * @param fpType - The raw fp_type string from the dismissal record
 * @returns Human-readable label
 */
function fpTypeLabel(fpType: string): string {
  switch (fpType) {
    case "not_vulnerable":
      return "Not vulnerable";
    case "accepted_risk":
      return "Accepted risk";
    case "wont_fix":
      return "Won't fix";
    case "duplicate":
      return "Duplicate";
    default:
      return fpType;
  }
}

/**
 * Formats an ISO timestamp to a human-readable relative time.
 *
 * @param iso - ISO 8601 timestamp
 * @returns Human-readable relative time string
 */
function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    return `${diffDays} days ago`;
  } catch {
    return iso;
  }
}

/** Returns the CSS class string for a tab link. */
function tabClass(active: boolean): string {
  return `px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
    active
      ? "border-accent text-accent"
      : "border-transparent text-fg/50 hover:text-fg"
  }`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Queue page — server component.
 *
 * Renders two tabs (link-based, SSR-friendly):
 * - "Open": ranked list of canonical, non-dismissed findings
 * - "Dismissed": FP bank — all active dismissals with re-open action
 *
 * URL: /queue (open tab) | /queue?tab=dismissed[&search=...] (dismissed tab)
 */
export default async function QueuePage({ searchParams }: PageProps) {
  const t = await getTranslations("queue");
  const tCommon = await getTranslations("common");
  const params = await searchParams;
  const tab = first(params.tab) ?? "open";
  const search = first(params.search) ?? "";
  const isDismissedTab = tab === "dismissed";

  const db = getDb();

  // ── Dismissed tab data ────────────────────────────────────────────────────
  let dismissals: DismissalDTO[] = [];
  if (isDismissedTab) {
    if (search.trim().length > 0) {
      dismissals = searchDismissals(db, search.trim());
    } else {
      dismissals = listActiveDismissals(db);
    }
  }

  // ── Open tab data ─────────────────────────────────────────────────────────
  const severityRaw = first(params.severity);
  const severity = severityRaw
    ? severityRaw.split(",").filter(Boolean)
    : undefined;
  const projectId = first(params.projectId)?.split(",").filter(Boolean);
  const hasPatch =
    first(params.hasPatch) === "true"
      ? true
      : first(params.hasPatch) === "false"
      ? false
      : undefined;
  const cursor = first(params.cursor);

  const result = getQueue(db, {
    cursor,
    limit: 50,
    severity,
    projectId,
    hasPatch,
    status: "open",
  });

  const stats = getQueueStats(db);

  const findingsWithBranch = result.items.map((finding) => {
    const branch = getBranchByFindingId(db, finding.id);
    return { finding, branchStatus: branch?.status ?? null };
  });

  const total = stats.total;
  const kevCount = stats.byKev;

  return (
    <div className="space-y-6">
      {/* Header + stats */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-fg/50">
            {t("subtitle", { count: total })}
            {kevCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-red-600">{kevCount} KEV</span>
              </>
            )}
          </p>
        </div>

        {/* Severity summary (open tab only) */}
        {!isDismissedTab && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg/50 tabular-nums">
            {(["critical", "high", "medium", "low", "info"] as const).map(
              (sev) => {
                const count = stats.bySeverity[sev] ?? 0;
                if (count === 0) return null;
                return (
                  <span key={sev} className="capitalize">
                    {sev}{" "}
                    <span className="font-semibold text-fg">{count}</span>
                  </span>
                );
              }
            )}
          </div>
        )}
      </div>

      {/* Tab bar — link-based (SSR-friendly) */}
      <div className="flex gap-1 border-b border-border">
        <Link href="/queue" className={tabClass(!isDismissedTab)}>
          {t("tabs.open")} ({total})
        </Link>
        <Link href="/queue?tab=dismissed" className={tabClass(isDismissedTab)}>
          {t("tabs.dismissed")}
          {isDismissedTab && dismissals.length > 0 && (
            <span className="ml-1.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
              {dismissals.length}
            </span>
          )}
        </Link>
      </div>

      {/* ── Open tab ──────────────────────────────────────────────────────── */}
      {!isDismissedTab && (
        <>
          {/* Filters */}
          <Suspense>
            <QueueFilters />
          </Suspense>

          {/* Findings list */}
          {findingsWithBranch.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-fg">{t("empty.title")}</h2>
              <p className="mt-1 text-sm text-fg/50">
                {t("empty.description")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {findingsWithBranch.map(({ finding, branchStatus }) => (
                <QueueItem
                  key={finding.id}
                  finding={finding}
                  branchStatus={branchStatus}
                />
              ))}

              {/* Pagination cursor */}
              {result.nextCursor && (
                <div className="flex justify-center pt-2">
                  <a
                    href={`/queue?${new URLSearchParams({
                      ...Object.fromEntries(
                        Object.entries(params).flatMap(([k, v]) =>
                          v === undefined
                            ? []
                            : [[k, Array.isArray(v) ? v.join(",") : v]]
                        )
                      ),
                      cursor: result.nextCursor,
                    }).toString()}`}
                    className="rounded-md border border-border px-4 py-2 text-sm text-fg/60 hover:bg-surface-hover hover:text-fg transition-colors"
                  >
                    {tCommon("loadMore")}
                  </a>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Dismissed tab ─────────────────────────────────────────────────── */}
      {isDismissedTab && (
        <div className="space-y-4">
          {/* Search box */}
          <FpBankSearch defaultValue={search} />

          {/* Dismissals list */}
          {dismissals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-fg">
                {search.trim().length > 0
                  ? tCommon("noResults")
                  : t("dismissedEmpty.title")}
              </p>
              <p className="mt-1 text-xs text-fg/50">
                {t("dismissedEmpty.description")}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-xs font-medium text-fg/50">
                    <th className="px-4 py-3">Finding</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Dismissed</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dismissals.map((d) => (
                    <tr
                      key={d.id}
                      className="bg-bg hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-fg">
                        {d.findingId}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-border px-2 py-0.5 text-xs font-medium text-fg/70">
                          {fpTypeLabel(d.fpType)}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs text-fg/70">
                        <span className="line-clamp-2" title={d.reason}>
                          {d.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-fg/50 whitespace-nowrap">
                        {formatDate(d.dismissedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <FpBankReOpenButton
                          findingId={d.findingId}
                          dismissalId={d.id}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
