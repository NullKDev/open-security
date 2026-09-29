import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const originalFetch = globalThis.fetch;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ConfigPage from "@/app/config/page";

describe("ConfigPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          models: {
            "llm-scan": "cli:claude",
            validate: null,
            filter: null,
            patch: null,
          },
        },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders config heading", async () => {
    render(<ConfigPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /config/i })).toBeInTheDocument();
    });
  });

  it("shows provider matrix with stage labels", async () => {
    render(<ConfigPage />);
    await waitFor(() => {
      expect(screen.getByText(/llm scan/i)).toBeInTheDocument();
      expect(screen.getByText(/validate/i)).toBeInTheDocument();
    });
  });

  it("shows coming soon section", async () => {
    render(<ConfigPage />);
    await waitFor(() => {
      const elements = screen.getAllByText(/coming soon/i);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("has a save button", async () => {
    render(<ConfigPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });
  });
});
