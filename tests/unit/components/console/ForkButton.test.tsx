import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForkButton } from "@/components/ui/console/ForkButton";
import { TimelineScrubber } from "@/components/ui/console/TimelineScrubber";

const originalFetch = globalThis.fetch;

const EVENTS = [
  { id: "evt-1", type: "agent_message", timestamp: "2024-01-01T00:00:00Z" },
  { id: "evt-2", type: "tool_call", timestamp: "2024-01-01T00:01:00Z" },
  { id: "evt-3", type: "tool_result", timestamp: "2024-01-01T00:02:00Z" },
];

describe("ForkButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: "new-scan" } }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders a Fork button", () => {
    render(<ForkButton scanId="scan-1" />);
    expect(screen.getByRole("button", { name: /fork/i })).toBeInTheDocument();
  });

  it("posts to /api/scans/[id]/fork with forkEventId on click", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: "new-scan" } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ForkButton scanId="scan-42" forkEventId="evt-99" />);
    await user.click(screen.getByRole("button", { name: /fork/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/scan-42/fork",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forkEventId: "evt-99" }),
        }),
      );
    });
  });

  it("posts without forkEventId when none is provided", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: "new-scan" } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ForkButton scanId="scan-1" />);
    await user.click(screen.getByRole("button", { name: /fork/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/scan-1/fork",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });
});

describe("TimelineScrubber", () => {
  it("renders a dot for each event", () => {
    const onSelect = vi.fn();
    render(<TimelineScrubber events={EVENTS} onSelect={onSelect} />);
    const dots = screen.getAllByRole("button");
    expect(dots).toHaveLength(3);
  });

  it("calls onSelect with event id when dot is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TimelineScrubber events={EVENTS} onSelect={onSelect} />);

    const dots = screen.getAllByRole("button");
    await user.click(dots[1]);

    expect(onSelect).toHaveBeenCalledWith("evt-2");
  });

  it("highlights selected event", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TimelineScrubber events={EVENTS} onSelect={onSelect} />);

    const dots = screen.getAllByRole("button");
    await user.click(dots[0]);

    expect(dots[0]).toHaveAttribute("aria-pressed", "true");
    expect(dots[1]).toHaveAttribute("aria-pressed", "false");
  });
});
