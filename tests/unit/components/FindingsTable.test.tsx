import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { FindingsTable } from "@/components/findings/FindingsTable";

const mockFindings = [
  {
    id: "f1",
    scanId: "s1",
    severity: "high",
    title: "SQL Injection in login",
    detector: "semgrep",
    locationPath: "src/login.ts",
    locationLineStart: 42,
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "f2",
    scanId: "s1",
    severity: "medium",
    title: "XSS in profile",
    detector: "semgrep",
    locationPath: "src/profile.tsx",
    locationLineStart: 88,
    createdAt: "2024-01-15T11:00:00Z",
  },
  {
    id: "f3",
    scanId: "s1",
    severity: "critical",
    title: "RCE via eval",
    detector: "bearer",
    locationPath: "src/utils.ts",
    locationLineStart: 12,
    createdAt: "2024-01-15T09:00:00Z",
  },
];

describe("FindingsTable", () => {
  it("renders table with column headers", () => {
    render(<FindingsTable findings={mockFindings} scanId="s1" />);
    expect(screen.getByText("Severity")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Detector")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
  });

  it("renders all finding rows", () => {
    render(<FindingsTable findings={mockFindings} scanId="s1" />);
    expect(screen.getByText("SQL Injection in login")).toBeInTheDocument();
    expect(screen.getByText("XSS in profile")).toBeInTheDocument();
    expect(screen.getByText("RCE via eval")).toBeInTheDocument();
  });

  it("shows severity badges for each finding", () => {
    render(<FindingsTable findings={mockFindings} scanId="s1" />);
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it("shows detector names", () => {
    render(<FindingsTable findings={mockFindings} scanId="s1" />);
    const semgrepBadges = screen.getAllByText("semgrep");
    expect(semgrepBadges).toHaveLength(2);
    expect(screen.getByText("bearer")).toBeInTheDocument();
  });

  it("sorts by severity when clicking severity header", async () => {
    const user = userEvent.setup();
    render(<FindingsTable findings={mockFindings} scanId="s1" />);

    // Click severity header to sort (ascending)
    await user.click(screen.getByText("Severity"));

    // Ascending severity: critical(0) → high(1) → medium(2)
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("critical");
    expect(rows[1]).toHaveTextContent("high");
    expect(rows[2]).toHaveTextContent("medium");
  });

  it("sorts by title when clicking title header", async () => {
    const user = userEvent.setup();
    render(<FindingsTable findings={mockFindings} scanId="s1" />);

    await user.click(screen.getByText("Title"));

    const rows = screen.getAllByRole("row").slice(1);
    // Alphabetically sorted: "RCE via eval" comes first
    expect(rows[0]).toHaveTextContent("RCE via eval");
  });

  it("renders empty state when no findings", () => {
    render(<FindingsTable findings={[]} scanId="s1" />);
    expect(screen.getByText(/no findings/i)).toBeInTheDocument();
  });

  it("shows location with line number", () => {
    render(<FindingsTable findings={mockFindings} scanId="s1" />);
    // Location is rendered as "src/login.ts:42"
    expect(screen.getByText(/src\/login\.ts:42/)).toBeInTheDocument();
  });
});
