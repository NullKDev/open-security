import { getTranslations } from "next-intl/server";
import { getDb } from "@/lib/db/client";
import {
  getTimeseries,
  getHotspots,
  getRegressionRate,
} from "@/lib/repos/posture.repo";
import { getMttr } from "@/lib/posture/mttr";
import { WeightedTimeseriesChart } from "@/components/posture/WeightedTimeseriesChart";
import { HotspotHeatmap } from "@/components/posture/HotspotHeatmap";
import { MttrCards } from "@/components/posture/MttrCards";
import { RegressionRateBadge } from "@/components/posture/RegressionRateBadge";

const RANGE_MAP: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
  all: 0,
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Security posture dashboard — server component.
 *
 * Renders four posture charts: severity-weighted timeseries, MTTR cards,
 * hotspot heatmap, and regression rate badge. Filterable by repo via
 * searchParams (REQ-PT-05).
 */
export default async function PosturePage({ searchParams }: PageProps) {
  const t = await getTranslations("posture");
  const params = await searchParams;
  const repo = first(params.repo);
  const rangeKey = first(params.range) ?? "30d";
  const rangeDays = RANGE_MAP[rangeKey] ?? 30;

  const db = getDb();

  const timeseries = getTimeseries(db, repo ?? "", rangeDays);
  const hotspots = getHotspots(db, repo ?? "");
  const regressionRate = getRegressionRate(db, repo ?? "", 30);
  const mttrRows = getMttr(db, repo ?? "");

  // Group MTTR rows into the three windows (30/60/90d), one window per severity rollup
  const windowMap = new Map<number, { medianSeconds: number; sampleSize: number; lowConfidence: boolean }>();
  for (const row of mttrRows) {
    const existing = windowMap.get(row.windowDays);
    if (!existing || row.sampleSize > existing.sampleSize) {
      windowMap.set(row.windowDays, {
        medianSeconds: row.medianSeconds ?? 0,
        sampleSize: row.sampleSize,
        lowConfidence: row.lowConfidence,
      });
    }
  }

  const windows = [30, 60, 90].map((days) => {
    const data = windowMap.get(days) ?? { medianSeconds: null, sampleSize: 0, lowConfidence: true };
    return {
      window: `${days}d`,
      medianSeconds: data.medianSeconds ?? null,
      avgSeconds: null,
      sampleSize: data.sampleSize,
      lowConfidence: data.lowConfidence,
    };
  });

  // Range filter options
  const ranges = ["7d", "30d", "60d", "90d", "all"];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-fg/50">
            {t("subtitle")}
          </p>
        </div>

        {/* Range filter */}
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
          {ranges.map((r) => (
            <a
              key={r}
              href={`/posture?${new URLSearchParams({
                ...(repo ? { repo } : {}),
                range: r,
              }).toString()}`}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                r === rangeKey
                  ? "bg-accent/10 text-accent"
                  : "text-fg/50 hover:text-fg hover:bg-surface-hover"
              }`}
            >
              {r}
            </a>
          ))}
        </div>
      </div>

      {/* Timeseries chart */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("weightedScore")}
        </h2>
        <WeightedTimeseriesChart
          data={timeseries.map((s) => ({
            date: s.bucketDate,
            weightedScore: s.weightedScore,
            countCritical: s.countCritical,
            countHigh: s.countHigh,
            countMedium: s.countMedium,
            countLow: s.countLow,
          }))}
        />
      </section>

      {/* MTTR + Regression rate row */}
      <div className="flex flex-wrap gap-6">
        <section className="flex-1 min-w-[300px]">
          <h2 className="mb-3 text-sm font-semibold text-fg">
            {t("mttr")}
          </h2>
          <MttrCards windows={windows} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-fg">
            {t("regressionRate")}
          </h2>
          <RegressionRateBadge
            rate30d={regressionRate.rate30d}
            count30d={regressionRate.count30d}
            totalFixes30d={regressionRate.totalFixes30d}
          />
        </section>
      </div>

      {/* Hotspot heatmap */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("hotspots")}
        </h2>
        <HotspotHeatmap cells={hotspots} />
      </section>
    </div>
  );
}
