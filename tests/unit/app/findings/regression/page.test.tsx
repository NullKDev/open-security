/**
 * tests/unit/app/findings/regression/page.test.tsx
 *
 * TDD: T-046 (RED) → GREEN — regression lineage page
 *
 * Shows the regression finding and its relationship to the original fixed finding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

vi.mock("@/lib/repos/findings.repo", () => ({
  getFindingById: vi.fn((_, id: string) => {
    if (id === "f-regression") {
      return {
        id: "f-regression",
        title: "SQL Injection regressed",
        severity: "high",
        status: "regression",
        isRegression: true,
        regressionOfFindingId: "f-original",
        location: "src/auth.ts:42",
      }
    }
    if (id === "f-original") {
      return {
        id: "f-original",
        title: "SQL Injection (original)",
        severity: "high",
        status: "fixed",
        isRegression: false,
        regressionOfFindingId: null,
        location: "src/auth.ts:42",
      }
    }
    return undefined
  }),
}));

vi.mock("@/lib/repos/regressions.repo", () => ({
  getRegressionLineage: vi.fn(() => ({
    id: "reg-001",
    originalFindingId: "f-original",
    regressedFindingId: "f-regression",
    originalBranchId: "branch-001",
    regressionCommitSha: "abc1234",
    detectedAt: "2024-02-01T10:00:00Z",
  })),
}));

vi.mock("@/components/findings/RegressionBadge", () => ({
  RegressionBadge: () => <span data-testid="regression-badge">Regression</span>,
}));

import RegressionPage from "@/app/findings/[id]/regression/page";

function makeParams(id: string) {
  return Promise.resolve({ id });
}

describe("RegressionPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the regression heading", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await RegressionPage({ params: makeParams("f-regression") }));
    expect(screen.getByRole("heading", { name: /regression/i })).toBeInTheDocument();
  });

  it("shows the regression finding title", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await RegressionPage({ params: makeParams("f-regression") }));
    expect(screen.getByText(/SQL Injection regressed/i)).toBeInTheDocument();
  });

  it("shows the original finding title", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await RegressionPage({ params: makeParams("f-regression") }));
    expect(screen.getByText(/SQL Injection \(original\)/i)).toBeInTheDocument();
  });

  it("renders the RegressionBadge", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await RegressionPage({ params: makeParams("f-regression") }));
    expect(screen.getByTestId("regression-badge")).toBeInTheDocument();
  });

  it("shows the regression commit SHA", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await RegressionPage({ params: makeParams("f-regression") }));
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
  });

  it("calls notFound when finding does not exist", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    const { notFound } = await import("next/navigation");
    await expect(
      RegressionPage({ params: makeParams("nonexistent") })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
