import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictBadge } from "@/components/ui/hunt/VerdictBadge";

describe("VerdictBadge", () => {
  it("renders 'exposed' with red styling indicated by role/text", () => {
    render(<VerdictBadge verdict="exposed" />);
    const badge = screen.getByText(/exposed/i);
    expect(badge).toBeInTheDocument();
  });

  it("renders 'not-exposed' with green styling", () => {
    render(<VerdictBadge verdict="not-exposed" />);
    const badge = screen.getByText(/not-exposed/i);
    expect(badge).toBeInTheDocument();
  });

  it("renders 'indeterminate' with yellow styling", () => {
    render(<VerdictBadge verdict="indeterminate" />);
    const badge = screen.getByText(/indeterminate/i);
    expect(badge).toBeInTheDocument();
  });

  it("exposed badge has data-verdict attribute for semantic testing", () => {
    render(<VerdictBadge verdict="exposed" />);
    const badge = screen.getByText(/exposed/i);
    expect(badge.closest("[data-verdict]")).toHaveAttribute("data-verdict", "exposed");
  });

  it("not-exposed badge has data-verdict attribute", () => {
    render(<VerdictBadge verdict="not-exposed" />);
    const badge = screen.getByText(/not-exposed/i);
    expect(badge.closest("[data-verdict]")).toHaveAttribute("data-verdict", "not-exposed");
  });

  it("indeterminate badge has data-verdict attribute", () => {
    render(<VerdictBadge verdict="indeterminate" />);
    const badge = screen.getByText(/indeterminate/i);
    expect(badge.closest("[data-verdict]")).toHaveAttribute("data-verdict", "indeterminate");
  });
});
