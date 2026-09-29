import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScanModePicker } from "../ScanModePicker";

describe("ScanModePicker", () => {
  it("renders four mode options (quick, standard, intermediate, paranoid)", () => {
    render(<ScanModePicker value="quick" onChange={() => {}} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
  });

  it("renders all four mode labels", () => {
    render(<ScanModePicker value="quick" onChange={() => {}} />);

    expect(screen.getByText("Quick")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Intermediate")).toBeInTheDocument();
    expect(screen.getByText("Paranoid")).toBeInTheDocument();
  });

  it("does NOT render the legacy 'Deep' option", () => {
    render(<ScanModePicker value="quick" onChange={() => {}} />);

    expect(screen.queryByText("Deep")).not.toBeInTheDocument();
  });

  it("shows Intermediate with domain-pass description", () => {
    render(<ScanModePicker value="quick" onChange={() => {}} />);

    expect(
      screen.getByText(/Project map \+ 3–4 targeted domain passes/),
    ).toBeInTheDocument();
  });

  it("shows Paranoid with fix-suggestions description", () => {
    render(<ScanModePicker value="quick" onChange={() => {}} />);

    expect(
      screen.getByText(/5–7 deep domain passes with inline fix suggestions/),
    ).toBeInTheDocument();
  });

  it("shows token cost estimates for LLM modes", () => {
    render(<ScanModePicker value="quick" onChange={() => {}} />);

    expect(screen.getByText("~50k tok")).toBeInTheDocument();
    expect(screen.getByText("~150k tok")).toBeInTheDocument();
    expect(screen.getByText("~350k tok")).toBeInTheDocument();
  });

  it("shows 'free' cost for Quick", () => {
    render(<ScanModePicker value="quick" onChange={() => {}} />);

    expect(screen.getByText("free")).toBeInTheDocument();
  });

  it("calls onChange with the clicked mode value", () => {
    const onChange = vi.fn();
    render(<ScanModePicker value="quick" onChange={onChange} />);

    fireEvent.click(screen.getByText("Standard"));
    expect(onChange).toHaveBeenCalledWith("standard");
  });

  it("calls onChange for intermediate", () => {
    const onChange = vi.fn();
    render(<ScanModePicker value="quick" onChange={onChange} />);

    fireEvent.click(screen.getByText("Intermediate"));
    expect(onChange).toHaveBeenCalledWith("intermediate");
  });

  it("calls onChange for paranoid", () => {
    const onChange = vi.fn();
    render(<ScanModePicker value="quick" onChange={onChange} />);

    fireEvent.click(screen.getByText("Paranoid"));
    expect(onChange).toHaveBeenCalledWith("paranoid");
  });

  it("calls onChange for quick", () => {
    const onChange = vi.fn();
    render(<ScanModePicker value="standard" onChange={onChange} />);

    fireEvent.click(screen.getByText("Quick"));
    expect(onChange).toHaveBeenCalledWith("quick");
  });

  it("highlights the currently active mode", () => {
    const { rerender } = render(<ScanModePicker value="quick" onChange={() => {}} />);

    // Initially Quick is active
    const quickBtn = screen.getByText("Quick").closest("button");
    expect(quickBtn?.className).toContain("bg-accent/10");

    // Switch to paranoid
    rerender(<ScanModePicker value="paranoid" onChange={() => {}} />);
    const paranoidBtn = screen.getByText("Paranoid").closest("button");
    expect(paranoidBtn?.className).toContain("bg-accent/10");

    // Quick should no longer be highlighted
    const quickAfter = screen.getByText("Quick").closest("button");
    expect(quickAfter?.className).not.toContain("bg-accent/10");
  });
});
