import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestDb } from "@/lib/db/client";
import Database from "better-sqlite3";
import { createProject } from "@/lib/repos/projects.repo";
import { createScan } from "@/lib/repos/scans.repo";
import { insertFinding } from "@/lib/repos/findings.repo";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

import Dashboard from "@/app/page";

function makeTestDb() {
  return createTestDb(new Database(":memory:"));
}

function seedProject(db: ReturnType<typeof createTestDb>) {
  const proj = createProject(db, {
    name: "my-repo",
    sourceKind: "github",
    sourceRef: "https://github.com/user/my-repo",
  });
  const scan = createScan(db, { projectId: proj.id });
  insertFinding(db, {
    scanId: scan.id,
    detector: "gitleaks",
    severity: "high",
    confidence: 0.95,
    title: "AWS key",
    locationPath: "config.yaml",
    locationLineStart: 14,
  });
  return { proj, scan };
}

describe("Dashboard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows getting started guide when no projects exist", async () => {
    const db = makeTestDb();
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await Dashboard());

    expect(screen.getByText("open-security")).toBeInTheDocument();
    expect(screen.getByText(/Blue Team security workbench/)).toBeInTheDocument();
    expect(screen.getByText("Local-first")).toBeInTheDocument();
    expect(screen.getByText("No login")).toBeInTheDocument();
    expect(screen.getByText("No telemetry")).toBeInTheDocument();
  });

  it("shows 'Projects' heading when projects exist", async () => {
    const db = makeTestDb();
    seedProject(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await Dashboard());

    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("renders project name on cards", async () => {
    const db = makeTestDb();
    seedProject(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await Dashboard());

    expect(screen.getByText("my-repo")).toBeInTheDocument();
  });

  it("shows source kind badge on project card", async () => {
    const db = makeTestDb();
    seedProject(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await Dashboard());

    expect(screen.getByText("github")).toBeInTheDocument();
  });

  it("shows scan and finding counts on project card", async () => {
    const db = makeTestDb();
    seedProject(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await Dashboard());

    expect(screen.getByText("1 scan")).toBeInTheDocument();
    expect(screen.getByText("1 finding")).toBeInTheDocument();
  });

  it("links project card to /projects/[id]", async () => {
    const db = makeTestDb();
    const { proj } = seedProject(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await Dashboard());

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/projects/${proj.id}`);
  });

  it("shows last scan status badge on project card", async () => {
    const db = makeTestDb();
    seedProject(db);
    vi.mocked((await import("@/lib/db/client")).getDb).mockReturnValue(db);
    render(await Dashboard());

    expect(screen.getByText("pending")).toBeInTheDocument();
  });
});
