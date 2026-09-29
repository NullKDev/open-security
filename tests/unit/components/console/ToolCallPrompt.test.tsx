import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallPrompt } from "@/components/ui/console/ToolCallPrompt";

const originalFetch = globalThis.fetch;

describe("ToolCallPrompt", () => {
  const onApprove = vi.fn();
  const onDeny = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders Approve and Deny buttons", () => {
    render(
      <ToolCallPrompt
        scanId="scan-1"
        toolCallId="tc-1"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  it("clicking Approve calls onApprove", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallPrompt
        scanId="scan-1"
        toolCallId="tc-1"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    await user.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
  });

  it("clicking Deny without redirect calls onDeny without posting to reject-tool", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <ToolCallPrompt
        scanId="scan-1"
        toolCallId="tc-1"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );

    await user.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() => expect(onDeny).toHaveBeenCalledTimes(1));
  });

  it("shows redirect textarea after Deny clicked", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallPrompt
        scanId="scan-1"
        toolCallId="tc-1"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );

    // There is no textarea initially
    expect(screen.queryByPlaceholderText(/redirect/i)).not.toBeInTheDocument();

    // Click deny to reveal the redirect textarea
    await user.click(screen.getByRole("button", { name: /deny/i }));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("sends POST to reject-tool with reason and redirectInstruction when deny+redirect submitted", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <ToolCallPrompt
        scanId="scan-77"
        toolCallId="tc-77"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );

    // Click deny to open redirect form
    await user.click(screen.getByRole("button", { name: /deny/i }));

    // Type redirect instruction
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Focus on read operations only");

    // Confirm rejection
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/scan-77/reject-tool",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolCallId: "tc-77",
            reason: "denied",
            redirectInstruction: "Focus on read operations only",
          }),
        }),
      );
    });
    await waitFor(() => expect(onDeny).toHaveBeenCalledTimes(1));
  });
});
