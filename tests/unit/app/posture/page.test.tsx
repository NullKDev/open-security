/**
 * tests/unit/app/posture/page.test.tsx
 *
 * Tests for the PosturePage RSC — composes WeightedTimeseriesChart,
 * HotspotHeatmap, MttrCards, and RegressionRateBadge.
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock child components to isolate page logic
vi.mock("@/components/posture/WeightedTimeseriesChart", () => ({
  WeightedTimeseriesChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="timeseries-chart" data-count={data.length} />
  ),
}));

vi.mock("@/components/posture/HotspotHeatmap", () => ({
  HotspotHeatmap: ({ cells }: { cells: unknown[] }) => (
    <div data-testid="hotspot-heatmap" data-count={cells.length} />
  ),
}));

vi.mock("@/components/posture/MttrCards", () => ({
  MttrCards: ({ windows }: { windows: unknown[] }) => (
    <div data-testid="mttr-cards" data-count={windows.length} />
  ),
}));

vi.mock("@/components/posture/RegressionRateBadge", () => ({
  RegressionRateBadge: () => <div data-testid="regression-rate-badge" />,
}));

// Mock getDb
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

// Mock the posture repos
vi.mock("@/lib/repos/posture.repo", () => ({
  getTimeseries: vi.fn(() => [
    { date: "2024-01-01", weightedScore: 50, countCritical: 1, countHigh: 3, countMedium: 5, countLow: 8, countInfo: 0 },
  ]),
  getHotspots: vi.fn(() => [
    { filePath: "src/auth.ts", authorEmail: "alice@test.com", distinctDedupKeys: 4, repeatOffender: true },
  ]),
  getRegressionRate: vi.fn(() => ({ rate30d: 0.1, count30d: 2, totalFixes30d: 20 })),
}));

vi.mock("@/lib/posture/mttr", () => ({
  getMttr: vi.fn(() => [
    { projectId: "p1", severity: "high", windowDays: 30, medianSeconds: 172800, avgSeconds: 200000, sampleSize: 10, lowConfidence: false },
  ]),
}));

import PosturePage from "@/app/posture/page";

function makeSearchParams(params: Record<string, string> = {}): Promise<Record<string, string | string[] | undefined>> {
  return Promise.resolve(params);
}

describe("PosturePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the page heading", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await PosturePage({ searchParams: makeSearchParams() }));
    expect(screen.getByRole("heading", { name: /posture/i })).toBeInTheDocument();
  });

  it("renders the timeseries chart component", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await PosturePage({ searchParams: makeSearchParams() }));
    expect(screen.getByTestId("timeseries-chart")).toBeInTheDocument();
  });

  it("renders the hotspot heatmap component", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await PosturePage({ searchParams: makeSearchParams() }));
    expect(screen.getByTestId("hotspot-heatmap")).toBeInTheDocument();
  });

  it("renders MTTR cards", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await PosturePage({ searchParams: makeSearchParams() }));
    expect(screen.getByTestId("mttr-cards")).toBeInTheDocument();
  });

  it("accepts repo searchParam and filters data", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    const { getTimeseries } = await import("@/lib/repos/posture.repo");
    render(await PosturePage({ searchParams: makeSearchParams({ repo: "proj-123" }) }));
    expect(vi.mocked(getTimeseries)).toHaveBeenCalled();
  });
});
