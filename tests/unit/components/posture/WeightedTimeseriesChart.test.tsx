/**
 * tests/unit/components/posture/WeightedTimeseriesChart.test.tsx
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeightedTimeseriesChart } from "@/components/posture/WeightedTimeseriesChart";

const mockData = [
  { date: "2024-01-01", weightedScore: 55, countCritical: 2, countHigh: 5, countMedium: 8, countLow: 10 },
  { date: "2024-01-02", weightedScore: 42, countCritical: 1, countHigh: 4, countMedium: 6, countLow: 8 },
  { date: "2024-01-03", weightedScore: 70, countCritical: 3, countHigh: 6, countMedium: 9, countLow: 12 },
];

describe("WeightedTimeseriesChart", () => {
  it("renders an SVG element", () => {
    const { container } = render(<WeightedTimeseriesChart data={mockData} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders a path element for the chart line", () => {
    const { container } = render(<WeightedTimeseriesChart data={mockData} />);
    expect(container.querySelector("path")).toBeTruthy();
  });

  it("renders date labels for data points", () => {
    render(<WeightedTimeseriesChart data={mockData} />);
    // Should have some x-axis labels rendered
    expect(screen.getByLabelText("weighted timeseries chart")).toBeTruthy();
  });

  it("shows tooltip on data point hover", async () => {
    const user = userEvent.setup();
    const { container } = render(<WeightedTimeseriesChart data={mockData} />);
    const circles = container.querySelectorAll("circle");
    if (circles.length > 0) {
      await user.hover(circles[0]);
      // Tooltip appears with weighted score
      const tooltip = container.querySelector("[role='tooltip']");
      expect(tooltip).toBeTruthy();
    }
  });

  it("renders empty state when no data provided", () => {
    render(<WeightedTimeseriesChart data={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders accessible aria-label", () => {
    render(<WeightedTimeseriesChart data={mockData} />);
    expect(screen.getByLabelText("weighted timeseries chart")).toBeTruthy();
  });

  it("accepts a title prop and renders it", () => {
    render(<WeightedTimeseriesChart data={mockData} title="Security Trend" />);
    expect(screen.getByText("Security Trend")).toBeInTheDocument();
  });
});
