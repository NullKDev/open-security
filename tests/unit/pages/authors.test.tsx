import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Database from "better-sqlite3";
import { createTestDb } from "@/lib/db/client";
import { createProject } from "@/lib/repos/projects.repo";
import { createScan } from "@/lib/repos/scans.repo";
import { upsertAuthor } from "@/lib/repos/authors.repo";

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

import AuthorsPage from "@/app/authors/[scanId]/page";

function makeTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  return createTestDb(sqlite);
}

describe("AuthorsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders authors heading", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await AuthorsPage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByRole("heading", { name: /authors/i })).toBeInTheDocument();
  });

  it("renders author cards with names", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    upsertAuthor(db, { scanId: scan.id, email: "alice@co.com", name: "Alice", commitCount: 42 });
    upsertAuthor(db, { scanId: scan.id, email: "bob@co.com", name: "Bob", commitCount: 7 });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await AuthorsPage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows commit count per author", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    upsertAuthor(db, { scanId: scan.id, email: "alice@co.com", name: "Alice", commitCount: 42 });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await AuthorsPage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows empty state when no authors", async () => {
    const db = makeTestDb();
    const proj = createProject(db, { name: "repo", sourceKind: "github", sourceRef: "url" });
    const scan = createScan(db, { projectId: proj.id });
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);

    render(await AuthorsPage({ params: Promise.resolve({ scanId: scan.id }) }));
    expect(screen.getByText(/no authors/i)).toBeInTheDocument();
  });
});
