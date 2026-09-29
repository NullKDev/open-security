import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NewScanPage from "@/app/scans/new/page";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const originalFetch = globalThis.fetch;

describe("NewScanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: "scan-123" },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the page with a card layout", () => {
    render(<NewScanPage />);
    expect(
      screen.getByRole("heading", { name: /new scan/i }),
    ).toBeInTheDocument();
  });

  it("renders unified SourceInput (no tabs — no Remote/Local radio)", () => {
    render(<NewScanPage />);

    // No segmented control buttons
    expect(screen.queryByRole("radio", { name: "Remote" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Local" })).not.toBeInTheDocument();

    // Old 4-tab Tabs must NOT exist
    expect(screen.queryByRole("tab", { name: "GitHub" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "GitLab" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "ZIP" })).not.toBeInTheDocument();

    // URL input always visible
    expect(screen.getByPlaceholderText("https://github.com/owner/repo")).toBeInTheDocument();
  });

  it("shows URL input always visible", () => {
    render(<NewScanPage />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    expect(input).toBeInTheDocument();
  });

  it("has a Start Scan submit button", () => {
    render(<NewScanPage />);
    expect(
      screen.getByRole("button", { name: /start scan/i }),
    ).toBeInTheDocument();
  });

  it("has Start Scan button disabled until source is valid", () => {
    render(<NewScanPage />);
    const btn = screen.getByRole("button", { name: /start scan/i });
    expect(btn).toBeDisabled();
  });

  it("submits form with sourceRef (not sourceUrl) and redirects on success", async () => {
    const user = userEvent.setup();
    render(<NewScanPage />);

    // Fill in the URL input
    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");

    // Blur to trigger validation (which sets sourceData)
    await user.tab();

    // Wait for button to become enabled after validation
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /start scan/i });
      expect(btn).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: /start scan/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/scans",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("sourceRef"),
        }),
      );
    });

    // Verify the body does NOT contain sourceUrl or sourcePath
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const bodyStr = calls[0][1].body;
    const body = JSON.parse(bodyStr);
    expect(body).toHaveProperty("sourceType");
    expect(body).toHaveProperty("sourceRef");
    expect(body).not.toHaveProperty("sourceUrl");
    expect(body).not.toHaveProperty("sourcePath");

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/scans/scan-123");
    });
  });

  it("shows error when API returns failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: "Authentication failed" },
      }),
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<NewScanPage />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");
    await user.tab();

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /start scan/i });
      expect(btn).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: /start scan/i }));

    await waitFor(() => {
      expect(screen.getByText(/authentication failed/i)).toBeInTheDocument();
    });
  });

  it("shows error on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<NewScanPage />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");
    await user.tab();

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /start scan/i });
      expect(btn).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: /start scan/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("shows loading state on submit button while submitting", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({
                  success: true,
                  data: { id: "scan-123" },
                }),
              }),
            100,
          ),
        ),
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<NewScanPage />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");
    await user.tab();

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /start scan/i });
      expect(btn).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: /start scan/i }));

    await waitFor(() => {
      expect(screen.getByTestId("spinner")).toBeInTheDocument();
    });
  });
});
