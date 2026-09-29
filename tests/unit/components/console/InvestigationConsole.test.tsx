import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvestigationConsole } from "@/components/ui/console/InvestigationConsole";

const originalFetch = globalThis.fetch;

describe("InvestigationConsole", () => {
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

  it("renders chat input at bottom", () => {
    render(<InvestigationConsole scanId="scan-1" status="running" />);
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(sendBtn).toBeInTheDocument();
  });

  it("input and button are disabled when status is not running", () => {
    render(<InvestigationConsole scanId="scan-1" status="pending" />);
    const input = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(input).toBeDisabled();
    expect(sendBtn).toBeDisabled();
  });

  it("input and button are enabled when status is running", () => {
    render(<InvestigationConsole scanId="scan-1" status="running" />);
    const input = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(input).not.toBeDisabled();
    expect(sendBtn).not.toBeDisabled();
  });

  it("sends POST to inject-prompt on submit with typed content", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<InvestigationConsole scanId="scan-42" status="running" />);
    const input = screen.getByRole("textbox");
    await user.type(input, "Check for SQL injection");
    const sendBtn = screen.getByRole("button", { name: /send/i });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/scan-42/inject-prompt",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Check for SQL injection" }),
        }),
      );
    });
  });

  it("clears input after successful submit", async () => {
    const user = userEvent.setup();
    render(<InvestigationConsole scanId="scan-1" status="running" />);
    const input = screen.getByRole("textbox");
    await user.type(input, "some message");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });
});
