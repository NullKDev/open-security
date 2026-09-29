import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HuntPage from "@/app/hunt/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hunt",
}));

const originalFetch = globalThis.fetch;

describe("HuntPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { id: "scan-hunt-1", status: "pending", verdict: null },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders CVE ID form input", () => {
    render(<HuntPage />);
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
  });

  it("renders submit button", () => {
    render(<HuntPage />);
    const btn = screen.getByRole("button", { name: /hunt/i });
    expect(btn).toBeInTheDocument();
  });

  it("sends POST to /api/scans/hunt on submit", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { id: "scan-hunt-1", status: "running", verdict: null },
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<HuntPage />);
    const input = screen.getByRole("textbox");
    await user.type(input, "CVE-2024-1234");
    await user.click(screen.getByRole("button", { name: /hunt/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/hunt",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("CVE-2024-1234"),
        }),
      );
    });
  });

  it("shows VerdictBadge when scan completes with verdict", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          data: { id: "scan-hunt-1", status: "completed", verdict: "exposed" },
        }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<HuntPage />);
    const input = screen.getByRole("textbox");
    await user.type(input, "CVE-2024-1234");
    await user.click(screen.getByRole("button", { name: /hunt/i }));

    await waitFor(() => {
      expect(screen.getByText(/exposed/i)).toBeInTheDocument();
    });
  });

  it("'Open as finding' button is disabled when verdict is not-exposed", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { id: "scan-hunt-1", status: "completed", verdict: "not-exposed" },
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<HuntPage />);
    const input = screen.getByRole("textbox");
    await user.type(input, "CVE-2024-1234");
    await user.click(screen.getByRole("button", { name: /hunt/i }));

    await waitFor(() => {
      const openBtn = screen.getByRole("button", { name: /open as finding/i });
      expect(openBtn).toBeDisabled();
    });
  });
});
