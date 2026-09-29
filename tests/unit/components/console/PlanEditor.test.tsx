import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanEditor } from "@/components/ui/console/PlanEditor";

const STEPS = [
  { index: 0, content: "Analyze authentication module", status: "pending" },
  { index: 1, content: "Check SQL queries", status: "in_progress" },
  { index: 2, content: "Review XSS vectors", status: "completed" },
];

const originalFetch = globalThis.fetch;

describe("PlanEditor", () => {
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

  it("renders list of plan steps", () => {
    render(<PlanEditor scanId="scan-1" steps={STEPS} />);
    expect(screen.getByText("Analyze authentication module")).toBeInTheDocument();
    expect(screen.getByText("Check SQL queries")).toBeInTheDocument();
    expect(screen.getByText("Review XSS vectors")).toBeInTheDocument();
  });

  it("click on step switches to edit mode with textarea", async () => {
    const user = userEvent.setup();
    render(<PlanEditor scanId="scan-1" steps={STEPS} />);

    const editBtn = screen.getAllByRole("button", { name: /edit/i })[0];
    await user.click(editBtn);

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("Analyze authentication module");
  });

  it("send plan update button calls POST to edit-plan with stepIndex and newContent", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<PlanEditor scanId="scan-99" steps={STEPS} />);

    const editBtns = screen.getAllByRole("button", { name: /edit/i });
    await user.click(editBtns[1]);

    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "Updated SQL check");

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scans/scan-99/edit-plan",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepIndex: 1, newContent: "Updated SQL check" }),
        }),
      );
    });
  });

  it("exits edit mode after save", async () => {
    const user = userEvent.setup();
    render(<PlanEditor scanId="scan-1" steps={STEPS} />);

    const editBtn = screen.getAllByRole("button", { name: /edit/i })[0];
    await user.click(editBtn);
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });
});
