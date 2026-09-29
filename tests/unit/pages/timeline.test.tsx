import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Database from "better-sqlite3";
import { createTestDb } from "@/lib/db/client";
import { createProject } from "@/lib/repos/projects.repo";
import { createScan } from "@/lib/repos/scans.repo";
import { upsertCommit } from "@/lib/repos/commits.repo";

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

import TimelinePage from "@/app/timeline/[scanId]/page";

function makeTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  return createTestDb(sqlite);
}

describe("TimelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders timeline heading", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await TimelinePage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByRole("heading", { name: /timeline/i })).toBeInTheDocument();
  });

  it("renders commit messages", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    upsertCommit(db, {
      sha: "abc123", scanId: scan.id, message: "Fix login bug",
      authorName: "Alice", authoredAt: "2024-01-01T00:00:00Z",
    });
    upsertCommit(db, {
      sha: "def456", scanId: scan.id, message: "Add feature X",
      authorName: "Bob", authoredAt: "2024-01-02T00:00:00Z",
    });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await TimelinePage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Add feature X")).toBeInTheDocument();
  });

  it("shows author names", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    upsertCommit(db, {
      sha: "abc123", scanId: scan.id, message: "msg",
      authorName: "Alice", authoredAt: "2024-01-01T00:00:00Z",
    });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await TimelinePage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
  });

  it("shows empty state when no commits", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await TimelinePage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByText(/no commits/i)).toBeInTheDocument();
  });
});
