import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestDb } from "@/lib/db/client";

// Mock next/navigation for client components
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: vi.fn(),
}));

// SecretTimelineView is an async RSC — stub it out in unit tests
vi.mock("@/components/ui/timeline/SecretTimelineView", () => ({
  SecretTimelineView: () => null,
}));
import Database from "better-sqlite3";
import { createProject } from "@/lib/repos/projects.repo";
import { createScan } from "@/lib/repos/scans.repo";
import { insertFinding } from "@/lib/repos/findings.repo";

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

import FindingDetailPage from "@/app/scans/[id]/findings/[fid]/page";

function makeTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = createTestDb(sqlite);
  return db;
}

function seedFinding(db: ReturnType<typeof createTestDb>) {
  // Foreign keys require a project + scan to exist
  const proj = createProject(db, {
    name: "my-repo",
    sourceKind: "github",
    sourceRef: "https://github.com/user/repo",
  });
  const scan = createScan(db, { projectId: proj.id });

  return insertFinding(db, {
    scanId: scan.id,
    detector: "gitleaks",
    severity: "high",
    confidence: 0.95,
    title: "AWS Access Key leaked",
    description: "An AWS access key was found in the configuration file.",
    locationPath: "config/app.yaml",
    locationLineStart: 42,
    locationLineEnd: 42,
    dataFlow: { steps: ["config.yaml → environment variable"] },
    evidenceHistory: [{ commit: "abc123", message: "Added config" }],
  });
}

describe("FindingDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders finding title", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(
      screen.getByText("AWS Access Key leaked"),
    ).toBeInTheDocument();
  });

  it("shows severity badge", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("shows detector name", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(screen.getByText("gitleaks")).toBeInTheDocument();
  });

  it("shows file location with line number", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(screen.getByText(/config\/app\.yaml/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("shows description", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(
      screen.getByText(
        /an aws access key was found in the configuration file/i,
      ),
    ).toBeInTheDocument();
  });

  it("shows data flow section", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(screen.getByText(/data flow/i)).toBeInTheDocument();
  });

  it("shows evidence section", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(screen.getByText(/evidence/i)).toBeInTheDocument();
  });

  it("shows Mark as False Positive button", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(
      screen.getByRole("button", { name: /false positive/i }),
    ).toBeInTheDocument();
  });

  it("shows Delete button", async () => {
    const db = makeTestDb();
    const finding = seedFinding(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(
      await FindingDetailPage({
        params: Promise.resolve({ id: finding.scanId, fid: finding.id }),
      }),
    );

    expect(
      screen.getByRole("button", { name: /delete/i }),
    ).toBeInTheDocument();
  });
});
