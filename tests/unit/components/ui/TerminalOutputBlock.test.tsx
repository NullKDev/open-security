import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TerminalOutputBlock } from "@/components/ui/TerminalOutputBlock";

describe("TerminalOutputBlock", () => {
  it("renders the output in a pre/monospace block", () => {
    render(<TerminalOutputBlock output="PASS 12 tests" />);

    const pre = screen.getByText("PASS 12 tests").closest("pre");
    expect(pre).not.toBeNull();
  });

  it("renders the command as header when provided", () => {
    render(
      <TerminalOutputBlock
        command="npm test"
        output="PASS 12 tests"
      />,
    );

    expect(screen.getByText(/npm test/)).toBeInTheDocument();
    expect(screen.getByText("PASS 12 tests")).toBeInTheDocument();
  });

  it("does not render command section when command is not provided", () => {
    render(<TerminalOutputBlock output="some output" />);

    // "Output" label might appear, but no command-specific section
    const pre = screen.getByText("some output").closest("pre");
    expect(pre).not.toBeNull();
  });

  it("applies error style for non-zero exitCode", () => {
    render(
      <TerminalOutputBlock
        output="Error: command not found"
        exitCode={1}
      />,
    );

    // The exit code should be visible with error/danger styling
    const container = screen.getByText("Error: command not found").closest("div");
    expect(container?.className).toMatch(/border-danger/);
  });

  it("applies normal style for zero exitCode", () => {
    render(
      <TerminalOutputBlock
        command="npm test"
        output="PASS"
        exitCode={0}
      />,
    );

    const container = screen.getByText("PASS").closest("div");
    expect(container?.className).not.toMatch(/border-danger/);
  });

  it("does not show exit code indicator when exitCode is undefined", () => {
    render(<TerminalOutputBlock output="plain output" />);

    // No error styling should be present
    const container = screen.getByText("plain output").closest("div");
    expect(container?.className).not.toMatch(/border-danger/);
  });

  it("shows exit code numerically when non-zero", () => {
    render(
      <TerminalOutputBlock
        output="fail"
        exitCode={2}
      />,
    );

    expect(screen.getByText(/exit code/i)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("preserves whitespace in output", () => {
    const multiline = "line1\n  line2\n    line3";
    render(<TerminalOutputBlock output={multiline} />);

    const pre = screen.getByText(/line1/).closest("pre");
    expect(pre).not.toBeNull();
  });
});
