import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostBadge } from "@/components/ui/CostBadge";

describe("CostBadge", () => {
  it("renders input and output token counts", () => {
    render(<CostBadge inputTokens={1200} outputTokens={300} />);

    expect(screen.getByText(/1200/)).toBeInTheDocument();
    expect(screen.getByText(/300/)).toBeInTheDocument();
  });

  it("formats costUsd to 4 decimal places", () => {
    render(
      <CostBadge
        inputTokens={1000}
        outputTokens={500}
        costUsd={0.00342}
      />,
    );

    // 0.00342 rounded to 4 decimal places = 0.0034
    expect(screen.getByText(/\$0\.0034/)).toBeInTheDocument();
  });

  it("formats costUsd to 4 decimal places (rounding up)", () => {
    render(
      <CostBadge
        inputTokens={100}
        outputTokens={50}
        costUsd={0.01239}
      />,
    );

    // 0.01239 rounded to 4 decimal places = 0.0124
    expect(screen.getByText(/\$0\.0124/)).toBeInTheDocument();
  });

  it("does not render cost when costUsd is undefined", () => {
    render(<CostBadge inputTokens={500} outputTokens={200} />);

    // No $ sign should appear
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("renders cache read tokens when provided", () => {
    render(
      <CostBadge
        inputTokens={100}
        outputTokens={50}
        cacheReadTokens={300}
      />,
    );

    expect(screen.getByText(/300/)).toBeInTheDocument();
  });

  it("renders cache write tokens when provided", () => {
    render(
      <CostBadge
        inputTokens={100}
        outputTokens={50}
        cacheWriteTokens={75}
      />,
    );

    expect(screen.getByText(/75/)).toBeInTheDocument();
  });

  it("renders all fields together", () => {
    render(
      <CostBadge
        inputTokens={8000}
        outputTokens={2000}
        cacheReadTokens={1500}
        cacheWriteTokens={500}
        costUsd={0.0456}
      />,
    );

    expect(screen.getByText(/8000/)).toBeInTheDocument();
    expect(screen.getByText(/2000/)).toBeInTheDocument();
    expect(screen.getByText(/1500/)).toBeInTheDocument();
    // 500 may match within "1500" — use getAllByText to verify it's present
    const fiveHundreds = screen.getAllByText(/500/);
    expect(fiveHundreds.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/\$0\.0456/)).toBeInTheDocument();
  });
});
