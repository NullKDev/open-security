import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestDb } from "@/lib/db/client";
import Database from "better-sqlite3";
import { createProject } from "@/lib/repos/projects.repo";
import { createScan } from "@/lib/repos/scans.repo";
import { insertFinding } from "@/lib/repos/findings.repo";

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

// Mock next/navigation for redirect and useSearchParams
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

import QueuePage from "@/app/queue/page";

function makeTestDb() {
  return createTestDb(new Database(":memory:"));
}

function makeSearchParams(
  params: Record<string, string> = {}
): Promise<Record<string, string | string[] | undefined>> {
  return Promise.resolve(params);
}

describe("QueuePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the page heading", async () => {
    const db = makeTestDb();
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await QueuePage({ searchParams: makeSearchParams() }));
    expect(screen.getByRole("heading", { name: /remediation queue/i })).toBeInTheDocument();
  });

  it("shows empty state when no findings exist", async () => {
    const db = makeTestDb();
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await QueuePage({ searchParams: makeSearchParams() }));
    expect(screen.getByText(/queue is clear/i)).toBeInTheDocument();
  });

  it("shows finding count in header", async () => {
    const db = makeTestDb();
    const project = createProject(db, {
      name: "test-repo",
      sourceKind: "local",
      sourceRef: "/tmp/test",
    });
    const scan = createScan(db, { projectId: project.id });
    insertFinding(db, {
      scanId: scan.id,
      detector: "gitleaks",
      severity: "high",
      confidence: 0.9,
      title: "AWS Key",
      locationPath: "config.yaml",
      locationLineStart: 1,
    });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await QueuePage({ searchParams: makeSearchParams() }));
    expect(screen.getByText(/1 finding open/)).toBeInTheDocument();
  });

  it("renders finding title from queue", async () => {
    const db = makeTestDb();
    const project = createProject(db, {
      name: "my-repo",
      sourceKind: "github",
      sourceRef: "https://github.com/user/my-repo",
    });
    const scan = createScan(db, { projectId: project.id });
    insertFinding(db, {
      scanId: scan.id,
      detector: "semgrep",
      severity: "critical",
      confidence: 0.99,
      title: "SQL Injection Vulnerability",
      locationPath: "app/query.ts",
      locationLineStart: 42,
    });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await QueuePage({ searchParams: makeSearchParams() }));
    expect(screen.getByText("SQL Injection Vulnerability")).toBeInTheDocument();
  });

  it("shows QueueFilters component", async () => {
    const db = makeTestDb();
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await QueuePage({ searchParams: makeSearchParams() }));
    // QueueFilters renders severity filter buttons and a search input
    expect(screen.getByPlaceholderText(/search findings/i)).toBeInTheDocument();
  });
});
