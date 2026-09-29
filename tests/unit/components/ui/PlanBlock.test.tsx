import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanBlock } from "@/components/ui/PlanBlock";

describe("PlanBlock", () => {
  it("renders all step titles in order", () => {
    const steps = [
      { title: "Analyze codebase", status: "done" as const },
      { title: "Scan for secrets", status: "in_progress" as const },
      { title: "Generate report", status: "pending" as const },
    ];

    render(<PlanBlock steps={steps} />);

    const titles = screen.getAllByText(/Analyze|Scan|Generate/);
    expect(titles).toHaveLength(3);
    expect(titles[0]).toHaveTextContent("Analyze codebase");
    expect(titles[1]).toHaveTextContent("Scan for secrets");
    expect(titles[2]).toHaveTextContent("Generate report");
  });

  it("applies distinct visual style for done status", () => {
    const steps = [{ title: "Done step", status: "done" as const }];
    render(<PlanBlock steps={steps} />);

    // Done steps should have a green/check visual indicator
    const item = screen.getByText("Done step").closest("li") ?? screen.getByText("Done step");
    // Should have success-related styling
    expect(item.className || (item.parentElement?.className ?? "")).toMatch(/text-success/);
  });

  it("applies distinct visual style for in_progress status", () => {
    const steps = [{ title: "Active step", status: "in_progress" as const }];
    render(<PlanBlock steps={steps} />);

    const item = screen.getByText("Active step").closest("li") ?? screen.getByText("Active step");
    // in_progress should be highlighted — blue or accent
    expect(item.className || (item.parentElement?.className ?? "")).toMatch(/text-accent/);
  });

  it("applies distinct visual style for error status", () => {
    const steps = [{ title: "Failed step", status: "error" as const }];
    render(<PlanBlock steps={steps} />);

    const item = screen.getByText("Failed step").closest("li") ?? screen.getByText("Failed step");
    expect(item.className || (item.parentElement?.className ?? "")).toMatch(/text-danger/);
  });

  it("applies muted style for pending status", () => {
    const steps = [{ title: "Pending step", status: "pending" as const }];
    render(<PlanBlock steps={steps} />);

    const item = screen.getByText("Pending step").closest("li") ?? screen.getByText("Pending step");
    // Pending should be gray/muted
    expect(item.className || (item.parentElement?.className ?? "")).toMatch(/text-fg\/30/);
  });

  it("handles empty steps array gracefully", () => {
    render(<PlanBlock steps={[]} />);

    // Should show a message or nothing — not crash
    expect(screen.queryByText(/no plan/i)).not.toBeNull();
  });

  it("highlights in_progress step with bold font weight", () => {
    const steps = [
      { title: "Step A", status: "done" as const },
      { title: "Step B", status: "in_progress" as const },
    ];

    render(<PlanBlock steps={steps} />);

    // Step B should be visually distinct from Step A
    const stepB = screen.getByText("Step B");
    const stepBContainer = stepB.closest("li") ?? stepB;
    const style = stepBContainer.className || (stepBContainer.parentElement?.className ?? "");
    // Should have heavier styling than done
    expect(style).toMatch(/font-semibold|font-bold/);
  });
});
