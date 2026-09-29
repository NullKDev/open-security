import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceInput } from "../SourceInput";

const originalFetch = globalThis.fetch;

describe("SourceInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { valid: true } }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders unified prompt text (no tabs)", () => {
    render(<SourceInput />);

    expect(
      screen.getByText(/Paste a Git URL — or — drop a folder \/ ZIP file/i),
    ).toBeInTheDocument();
  });

  it("renders URL input always visible", () => {
    render(<SourceInput />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    expect(input).toBeInTheDocument();
  });

  it("renders drop zone always visible", () => {
    render(<SourceInput />);

    expect(
      screen.getByRole("button", {
        name: "Drop folder or ZIP file, or click to browse",
      }),
    ).toBeInTheDocument();
  });

  it("does NOT render Remote/Local tabs", () => {
    render(<SourceInput />);

    expect(screen.queryByRole("radio", { name: "Remote" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Local" })).not.toBeInTheDocument();
  });

  it("does NOT render Folder/ZIP sub-tabs", () => {
    render(<SourceInput />);

    expect(screen.queryByRole("radio", { name: "Folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "ZIP" })).not.toBeInTheDocument();
  });

  it("shows GitHub badge when URL is typed", async () => {
    const user = userEvent.setup();
    render(<SourceInput />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    // RemoteMode uses internal 300ms debounce for badge
    await user.type(input, "https://github.com/user/repo");

    // GitHub badge should appear (within RemoteMode's debounce)
    await waitFor(
      () => {
        expect(screen.getByText("GitHub")).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  it("calls onChange with valid SourceData when remote URL is entered", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<SourceInput onChange={onChange} />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");
    await user.tab(); // blur triggers validation

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "github",
          sourceRef: "https://github.com/user/repo",
        }),
      );
    });
  });

  it("calls onValidationChange with validity state", async () => {
    const user = userEvent.setup();
    const onValidationChange = vi.fn();

    render(<SourceInput onValidationChange={onValidationChange} />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");
    await user.tab();

    await waitFor(() => {
      expect(onValidationChange).toHaveBeenCalledWith(true);
    }, { timeout: 2000 });
  });

  it("renders drop zone with Choose ZIP File button", () => {
    render(<SourceInput />);

    expect(screen.getByText("Choose ZIP File")).toBeInTheDocument();
  });

  it("shows Clear selection button when something is selected (URL typed)", async () => {
    const user = userEvent.setup();
    render(<SourceInput />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");

    await waitFor(() => {
      expect(screen.getByText("Clear selection")).toBeInTheDocument();
    });
  });

  it("clears selection when Clear button is clicked", async () => {
    const user = userEvent.setup();
    render(<SourceInput />);

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");

    await waitFor(() => {
      expect(screen.getByText("Clear selection")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Clear selection"));

    // URL input should be cleared
    expect(input).toHaveValue("");
  });
});
