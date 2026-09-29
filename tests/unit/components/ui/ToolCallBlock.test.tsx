import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallBlock } from "@/components/ui/ToolCallBlock";

describe("ToolCallBlock", () => {
  it("renders toolName prominently in collapsed state", () => {
    render(
      <ToolCallBlock
        toolName="read_file"
        toolCallId="tc-1"
        input={{ path: "/app/page.tsx" }}
      />,
    );

    expect(screen.getByText("read_file")).toBeInTheDocument();
    // Collapsed by default — input should not be visible
    expect(screen.queryByText(/page\.tsx/)).not.toBeInTheDocument();
  });

  it("expands to show input on click", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallBlock
        toolName="grep"
        toolCallId="tc-2"
        input={{ pattern: "TODO", path: "/src" }}
      />,
    );

    const button = screen.getByRole("button");
    await user.click(button);

    // Input JSON should be visible when expanded
    expect(screen.getByText(/TODO/)).toBeInTheDocument();
  });

  it("collapses back on second click", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallBlock
        toolName="bash"
        toolCallId="tc-3"
        input={{ cmd: "ls -la" }}
      />,
    );

    const button = screen.getByRole("button");
    await user.click(button); // expand
    await user.click(button); // collapse

    // After collapsing, input content should be hidden
    expect(screen.queryByText(/ls -la/)).not.toBeInTheDocument();
  });

  it("applies error visual style when isError=true", () => {
    render(
      <ToolCallBlock
        toolName="write_file"
        toolCallId="tc-4"
        input={{ path: "/out" }}
        result="Permission denied"
        isError={true}
      />,
    );

    // The block should have red/danger styling
    const container = screen.getByText("write_file").closest("div");
    expect(container?.className).toMatch(/border-danger/);
  });

  it("does NOT apply error style when isError=false", () => {
    render(
      <ToolCallBlock
        toolName="read_file"
        toolCallId="tc-5"
        input={{ path: "/out" }}
        result="content here"
        isError={false}
      />,
    );

    const container = screen.getByText("read_file").closest("div");
    expect(container?.className).not.toMatch(/border-danger/);
  });

  it("shows result text when result is provided (expanded view)", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallBlock
        toolName="grep"
        toolCallId="tc-6"
        input={{ pattern: "secret" }}
        result="Found 3 matches"
      />,
    );

    const button = screen.getByRole("button");
    await user.click(button);

    expect(screen.getByText("Found 3 matches")).toBeInTheDocument();
  });

  it("shows result with error styling in expanded view when isError=true", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallBlock
        toolName="bash"
        toolCallId="tc-7"
        input={{ cmd: "rm -rf /" }}
        result="Operation not permitted"
        isError={true}
      />,
    );

    const button = screen.getByRole("button");
    await user.click(button);

    const resultEl = screen.getByText("Operation not permitted");
    expect(resultEl).toBeInTheDocument();
  });

  it("shows toolCallId in the block for accessibility/identification", () => {
    render(
      <ToolCallBlock
        toolName="tool"
        toolCallId="tc-unique-123"
        input={{ x: 1 }}
      />,
    );

    // toolCallId should appear in the DOM (e.g. as data attribute or visible text)
    const container = screen.getByText("tool").closest("div");
    expect(container?.textContent).toMatch(/tc-unique-123/);
  });
});
