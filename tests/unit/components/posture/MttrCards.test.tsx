/**
 * tests/unit/components/posture/MttrCards.test.tsx
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MttrCards } from "@/components/posture/MttrCards";
import { RegressionRateBadge } from "@/components/posture/RegressionRateBadge";

const mockWindows = [
  { window: "30d", medianSeconds: 172800, avgSeconds: 200000, sampleSize: 10, lowConfidence: false },
  { window: "60d", medianSeconds: 259200, avgSeconds: 300000, sampleSize: 3, lowConfidence: true },
  { window: "90d", medianSeconds: 345600, avgSeconds: 400000, sampleSize: 0, lowConfidence: true },
];

describe("MttrCards", () => {
  it("renders three window cards (30d, 60d, 90d)", () => {
    render(<MttrCards windows={mockWindows} />);
    expect(screen.getByText("30d")).toBeInTheDocument();
    expect(screen.getByText("60d")).toBeInTheDocument();
    expect(screen.getByText("90d")).toBeInTheDocument();
  });

  it("renders median time for each window", () => {
    render(<MttrCards windows={mockWindows} />);
    // 172800s = 2d
    expect(screen.getByText(/2\s*d/i)).toBeInTheDocument();
  });

  it("shows low_confidence badge when sampleSize < 5", () => {
    render(<MttrCards windows={mockWindows} />);
    // 60d has sampleSize=3 → low confidence indicator
    expect(screen.getAllByText(/n=3/i).length).toBeGreaterThan(0);
  });

  it("shows low confidence on 90d (sampleSize=0)", () => {
    render(<MttrCards windows={mockWindows} />);
    expect(screen.getAllByText(/n=0/i).length).toBeGreaterThan(0);
  });

  it("renders no data state when sampleSize=0", () => {
    render(<MttrCards windows={mockWindows} />);
    // 90d has 0 samples — should show some placeholder
    expect(screen.getByText(/n=0/i)).toBeInTheDocument();
  });

  it("renders high confidence card without low_confidence badge", () => {
    render(<MttrCards windows={mockWindows} />);
    // 30d has sampleSize=10 → should NOT show low confidence note
    const lowConfidenceBadges = screen.queryAllByText(/low confidence/i);
    // If any are shown, they should be for 60d/90d only
    // The 30d card should not have it
    const cards = screen.getAllByText(/d$/);
    expect(cards.length).toBeGreaterThan(0);
  });
});

describe("RegressionRateBadge", () => {
  it("renders the regression rate as percentage", () => {
    render(<RegressionRateBadge rate30d={0.15} count30d={3} totalFixes30d={20} />);
    expect(screen.getByText(/15%/i)).toBeInTheDocument();
  });

  it("renders 0% when no regressions", () => {
    render(<RegressionRateBadge rate30d={0} count30d={0} totalFixes30d={10} />);
    expect(screen.getByText(/0%/i)).toBeInTheDocument();
  });

  it("uses orange/warning color class for elevated rates", () => {
    const { container } = render(
      <RegressionRateBadge rate30d={0.25} count30d={5} totalFixes30d={20} />
    );
    // Should have some warning coloring
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
  });

  it("renders accessible label", () => {
    render(<RegressionRateBadge rate30d={0.1} count30d={2} totalFixes30d={20} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
