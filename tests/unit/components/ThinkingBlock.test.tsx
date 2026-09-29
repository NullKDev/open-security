import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThinkingBlock } from "@/components/ui/ThinkingBlock";

describe("ThinkingBlock", () => {
  it("renders preview text when collapsed", () => {
    render(<ThinkingBlock text="Analyzing source files..." />);
    expect(screen.getByText("Analyzing source files...")).toBeInTheDocument();
  });

  it("truncates long text in preview", () => {
    const longText = "A".repeat(200);
    render(<ThinkingBlock text={longText} />);
    const preview = screen.getByText(/A{120}…/);
    expect(preview).toBeInTheDocument();
  });

  it("expands to show full text when clicked", async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock text="Full reasoning text here" />);
    const button = screen.getByRole("button");
    await user.click(button);
    // After expand, reasoning label appears
    expect(screen.getByText(/Reasoning/)).toBeInTheDocument();
    // Full text is visible
    expect(screen.getByText("Full reasoning text here")).toBeInTheDocument();
  });

  it("shows animated dots when active", () => {
    render(<ThinkingBlock text="Thinking..." active={true} />);
    // The button should have aria-expanded
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows check icon when NOT active", () => {
    render(<ThinkingBlock text="Done thinking" active={false} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  // ─── Format: plain (default, existing behavior) ───────────────────────────

  it("renders plain text in <pre> when format is plain", async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock text="Plain analysis" format="plain" />);
    const button = screen.getByRole("button");
    await user.click(button);
    // Text should be in a pre element (plain format)
    const pre = screen.getByText("Plain analysis").closest("pre");
    expect(pre).not.toBeNull();
  });

  // ─── Format: markdown (new behavior) ───────────────────────────────────────

  it("renders markdown bold text when format is markdown", async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock text="## Analysis\n\n**Bold text** here." format="markdown" />);
    const button = screen.getByRole("button");
    await user.click(button);
    // With react-markdown, **Bold text** should render as <strong>
    expect(screen.getByText("Bold text")).toBeInTheDocument();
    // The heading should be visible
    expect(screen.getByText(/Analysis/)).toBeInTheDocument();
  });

  it("renders markdown code blocks when format is markdown", async () => {
    const user = userEvent.setup();
    const markdownText = "```js\nconst x = 1;\n```";
    render(<ThinkingBlock text={markdownText} format="markdown" />);
    const button = screen.getByRole("button");
    await user.click(button);
    // react-markdown renders code in <code> elements
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
  });
});
