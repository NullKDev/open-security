/**
 * tests/unit/app/findings/verify/page.test.tsx
 *
 * Tests for the Fix & Prove verify page.
 * Shows triad steps UI with SWR polling of proof status.
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
}));

// Mock getDb
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

// Mock findings repo
vi.mock("@/lib/repos/findings.repo", () => ({
  getFindingById: vi.fn(() => ({
    id: "f-001",
    title: "SQL Injection in login",
    severity: "high",
    status: "open",
    patchDiff: "--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1 +1 @@",
    proofOfFixId: null,
  })),
}));

// Mock fix-proofs repo
vi.mock("@/lib/repos/fix-proofs.repo", () => ({
  getLatestProof: vi.fn(() => null),
}));

import VerifyPage from "@/app/findings/[id]/verify/page";

function makeParams(id: string) {
  return Promise.resolve({ id });
}

describe("VerifyPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the verify page heading", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await VerifyPage({ params: makeParams("f-001") }));
    expect(screen.getByRole("heading", { name: /fix.*prove|verify/i })).toBeInTheDocument();
  });

  it("shows the finding title", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await VerifyPage({ params: makeParams("f-001") }));
    expect(screen.getByText(/SQL Injection/i)).toBeInTheDocument();
  });

  it("shows triad step labels", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await VerifyPage({ params: makeParams("f-001") }));
    // Three triad steps: unit test, regression test authored, vul run
    const steps = screen.getAllByText(/unit test|regression test|vuln/i);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("shows 'Start Fix & Prove' button when no proof exists", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    render(await VerifyPage({ params: makeParams("f-001") }));
    expect(screen.getByRole("button", { name: /start|run|fix.*prove/i })).toBeInTheDocument();
  });

  it("shows ProofOfFixBadge when proof exists", async () => {
    const { getDb, createTestDb } = await import("@/lib/db/client");
    const Database = (await import("better-sqlite3")).default;
    vi.mocked(getDb).mockReturnValue(createTestDb(new Database(":memory:")));

    const { getLatestProof } = await import("@/lib/repos/fix-proofs.repo");
    vi.mocked(getLatestProof).mockReturnValueOnce({
      id: "proof-1",
      findingId: "f-001",
      branchId: null,
      patchDiff: "...",
      regressionTestPath: "tests/__regression__/auth.test.ts",
      regressionTestDiff: null,
      unitTestPassed: true,
      vulRunPassedPre: false,
      vulRunPassedPost: true,
      outcome: "verified-fixed",
      failureReason: null,
      prePatchOutput: "FAIL",
      postPatchOutput: "PASS",
      unitTestOutput: null,
      startedAt: "2024-01-15T10:00:00Z",
      completedAt: "2024-01-15T12:00:00Z",
      acpSessionId: null,
    });

    render(await VerifyPage({ params: makeParams("f-001") }));
    expect(screen.getByText(/verified.?fix/i)).toBeInTheDocument();
  });
});
