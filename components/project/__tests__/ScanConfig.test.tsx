import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScanConfig } from "../ScanConfig";

// Mock ScrollArea used by Sidebar
vi.mock("@/components/ui/ScrollArea", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="scroll-area">{children}</div>
  ),
}));

describe("ScanConfig", () => {  it("renders four intensity options (not three)", () => {
    render(
      <ScanConfig projectName="test" onSubmit={() => {}} />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
  });

  it("renders Intermediate intensity label", () => {
    render(
      <ScanConfig projectName="test" onSubmit={() => {}} />,
    );

    expect(screen.getByText("Intermediate")).toBeInTheDocument();
  });

  it("renders Paranoid intensity label", () => {
    render(
      <ScanConfig projectName="test" onSubmit={() => {}} />,
    );

    expect(screen.getByText("Paranoid")).toBeInTheDocument();
  });

  it("does NOT render the legacy Deep option", () => {
    render(
      <ScanConfig projectName="test" onSubmit={() => {}} />,
    );

    expect(screen.queryByText("Deep")).not.toBeInTheDocument();
  });

  it("shows Intermediate cost estimate", () => {
    render(
      <ScanConfig projectName="test" onSubmit={() => {}} />,
    );

    expect(
      screen.getByText(/Project map \+ 3–4 targeted domain passes/),
    ).toBeInTheDocument();
  });

  it("shows Paranoid cost estimate", () => {
    render(
      <ScanConfig projectName="test" onSubmit={() => {}} />,
    );

    expect(
      screen.getByText(/5–7 deep domain passes with inline fix/),
    ).toBeInTheDocument();
  });

  it("submits intermediate intensity correctly", () => {
    const onSubmit = vi.fn();
    render(
      <ScanConfig projectName="test" onSubmit={onSubmit} />,
    );

    // Click the Intermediate radio label (label wraps the radio)
    fireEvent.click(screen.getByText("Intermediate"));
    fireEvent.click(screen.getByRole("button", { name: /start scan/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ intensity: "intermediate" }),
    );
  });

  it("submits paranoid intensity correctly", () => {
    const onSubmit = vi.fn();
    render(
      <ScanConfig projectName="test" onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByText("Paranoid"));
    fireEvent.click(screen.getByRole("button", { name: /start scan/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ intensity: "paranoid" }),
    );
  });

  it("submits quick intensity correctly (existing mode still works)", () => {
    const onSubmit = vi.fn();
    render(
      <ScanConfig projectName="test" onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByText("Quick"));
    fireEvent.click(screen.getByRole("button", { name: /start scan/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ intensity: "quick" }),
    );
  });

  it("submits standard intensity correctly (existing mode still works)", () => {
    const onSubmit = vi.fn();
    render(
      <ScanConfig projectName="test" onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByText("Standard"));
    fireEvent.click(screen.getByRole("button", { name: /start scan/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ intensity: "standard" }),
    );
  });
});
