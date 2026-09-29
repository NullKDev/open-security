import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionDialog } from "@/components/ui/PermissionDialog";

const originalFetch = globalThis.fetch;

describe("PermissionDialog", () => {
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

  it("shows toolName and input in the dialog", () => {
    render(
      <PermissionDialog
        requestId="pr-1"
        toolName="bash"
        input={{ cmd: "rm important.txt" }}
        timeoutMs={60000}
        scanId="scan-1"
        onSettled={vi.fn()}
      />,
    );

    expect(screen.getByText("bash")).toBeInTheDocument();
    // Input should be visible
    expect(screen.getByText(/rm important\.txt/)).toBeInTheDocument();
  });

  it("displays countdown timer in seconds", () => {
    render(
      <PermissionDialog
        requestId="pr-2"
        toolName="write_file"
        input={{ path: "/etc/hosts" }}
        timeoutMs={60000}
        scanId="scan-2"
        onSettled={vi.fn()}
      />,
    );

    // Should show seconds remaining (e.g., "60s" or "60")
    expect(screen.getByText(/60/)).toBeInTheDocument();
  });

  it("calls POST with approved:true when Approve is clicked", async () => {
    const onSettled = vi.fn();
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <PermissionDialog
        requestId="pr-3"
        toolName="read_file"
        input={{ path: "/foo" }}
        timeoutMs={60000}
        scanId="scan-3"
        onSettled={onSettled}
      />,
    );

    const approveBtn = screen.getByRole("button", { name: /approve/i });
    await user.click(approveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/scan-3/permission",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: "pr-3", approved: true }),
        }),
      );
    });
  });

  it("calls POST with approved:false when Deny is clicked", async () => {
    const onSettled = vi.fn();
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <PermissionDialog
        requestId="pr-4"
        toolName="bash"
        input={{ cmd: "rm -rf /" }}
        timeoutMs={60000}
        scanId="scan-4"
        onSettled={onSettled}
      />,
    );

    const denyBtn = screen.getByRole("button", { name: /deny/i });
    await user.click(denyBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/scan-4/permission",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: "pr-4", approved: false }),
        }),
      );
    });
  });

  it("calls onSettled after POST completes", async () => {
    const onSettled = vi.fn();
    const user = userEvent.setup();

    render(
      <PermissionDialog
        requestId="pr-5"
        toolName="read_file"
        input={{ path: "/bar" }}
        timeoutMs={60000}
        scanId="scan-5"
        onSettled={onSettled}
      />,
    );

    const approveBtn = screen.getByRole("button", { name: /approve/i });
    await user.click(approveBtn);

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  it("auto-dismisses on timeout and calls onSettled without making POST", async () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <PermissionDialog
        requestId="pr-6"
        toolName="bash"
        input={{ cmd: "ls" }}
        timeoutMs={1000}
        scanId="scan-6"
        onSettled={onSettled}
      />,
    );

    // Initially visible
    expect(screen.getByText("bash")).toBeInTheDocument();

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(1100);

    // onSettled should be called
    expect(onSettled).toHaveBeenCalledTimes(1);

    // fetch should NOT have been called (no POST on timeout)
    expect(fetchMock).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("disables buttons after choice is made", async () => {
    const user = userEvent.setup();
    let resolveFetch: (val: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise.then(() => ({
      ok: true,
      json: async () => ({ ok: true }),
    })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <PermissionDialog
        requestId="pr-7"
        toolName="bash"
        input={{ cmd: "ls" }}
        timeoutMs={60000}
        scanId="scan-7"
        onSettled={vi.fn()}
      />,
    );

    const approveBtn = screen.getByRole("button", { name: /approve/i });
    await user.click(approveBtn);

    // Button should be disabled while request is in-flight
    expect(approveBtn).toBeDisabled();

    resolveFetch!({ ok: true, json: async () => ({ ok: true }) });
    await waitFor(() => fetchPromise);
  });

  it("does not contain .obt string literals", () => {
    render(
      <PermissionDialog
        requestId="pr-8"
        toolName="test"
        input={{}}
        timeoutMs={60000}
        scanId="scan-8"
        onSettled={vi.fn()}
      />,
    );

    // All rendered text should not contain .obt
    const dialogHtml = document.body.innerHTML;
    expect(dialogHtml).not.toContain(".obt");
  });
});
