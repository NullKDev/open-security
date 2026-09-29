/**
 * tests/unit/components/posture/HotspotHeatmap.test.tsx
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HotspotHeatmap } from "@/components/posture/HotspotHeatmap";

const mockCells = [
  { filePath: "src/auth/login.ts", authorEmail: "alice@example.com", distinctDedupKeys: 5, repeatOffender: true },
  { filePath: "src/api/users.ts", authorEmail: "bob@example.com", distinctDedupKeys: 2, repeatOffender: false },
  { filePath: "src/auth/login.ts", authorEmail: "bob@example.com", distinctDedupKeys: 3, repeatOffender: true },
  { filePath: "src/utils.ts", authorEmail: "alice@example.com", distinctDedupKeys: 1, repeatOffender: false },
];

describe("HotspotHeatmap", () => {
  it("renders a grid container", () => {
    const { container } = render(<HotspotHeatmap cells={mockCells} />);
    // Should have a table or grid element
    expect(container.querySelector("table") || container.querySelector('[role="grid"]')).toBeTruthy();
  });

  it("renders cells for each data point", () => {
    render(<HotspotHeatmap cells={mockCells} />);
    // Should show file path and author
    expect(screen.getByText(/login\.ts/i)).toBeInTheDocument();
  });

  it("uses repeat_offender accent color on hotspot cells", () => {
    const { container } = render(<HotspotHeatmap cells={mockCells} />);
    // Cells with repeatOffender=true should have a distinct visual treatment
    const repeatCells = container.querySelectorAll("[data-repeat-offender='true']");
    expect(repeatCells.length).toBeGreaterThan(0);
  });

  it("renders empty state when no cells provided", () => {
    render(<HotspotHeatmap cells={[]} />);
    expect(screen.getByText(/no hotspots/i)).toBeInTheDocument();
  });

  it("renders accessible aria-label", () => {
    render(<HotspotHeatmap cells={mockCells} />);
    expect(screen.getByLabelText("hotspot heatmap")).toBeTruthy();
  });

  it("shows distinctDedupKeys count in cells", () => {
    render(<HotspotHeatmap cells={mockCells} />);
    // The count 5 should be visible somewhere
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("accepts a title prop and renders it", () => {
    render(<HotspotHeatmap cells={mockCells} title="File Hotspots" />);
    expect(screen.getByText("File Hotspots")).toBeInTheDocument();
  });
});
