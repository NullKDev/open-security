/**
 * tests/unit/components/findings/RegressionBadge.test.tsx
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegressionBadge } from "@/components/findings/RegressionBadge";

describe("RegressionBadge", () => {
  it("renders REGRESSION text", () => {
    render(<RegressionBadge />);
    expect(screen.getByText(/regression/i)).toBeInTheDocument();
  });

  it("has orange/warning styling", () => {
    const { container } = render(<RegressionBadge />);
    const el = container.firstChild as HTMLElement;
    // Should have orange/warning class (text-orange or text-warning)
    expect(el.className).toMatch(/orange|warning/i);
  });

  it("has an aria-label for accessibility", () => {
    render(<RegressionBadge />);
    expect(screen.getByLabelText(/regression/i)).toBeInTheDocument();
  });

  it("is stateless — renders same output each time", () => {
    const { container: c1 } = render(<RegressionBadge />);
    const { container: c2 } = render(<RegressionBadge />);
    expect(c1.innerHTML).toBe(c2.innerHTML);
  });

  it("can accept an optional className prop", () => {
    const { container } = render(<RegressionBadge className="my-custom-class" />);
    expect(container.innerHTML).toContain("my-custom-class");
  });
});
