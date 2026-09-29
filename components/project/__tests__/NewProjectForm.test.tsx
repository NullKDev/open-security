import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewProjectForm } from "../NewProjectForm";

const originalFetch = globalThis.fetch;

describe("NewProjectForm", () => {
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

  it("renders project name input", () => {
    render(<NewProjectForm onSubmit={() => {}} />);
    expect(screen.getByLabelText("Project name")).toBeInTheDocument();
  });

  it("renders SourceInput with unified prompt (no Remote/Local tabs)", () => {
    render(<NewProjectForm onSubmit={() => {}} />);
    // No "Remote" or "Local" radio buttons
    expect(screen.queryByRole("radio", { name: "Remote" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Local" })).not.toBeInTheDocument();
    // URL input always visible
    expect(screen.getByPlaceholderText("https://github.com/owner/repo")).toBeInTheDocument();
  });

  it("has Create Project button disabled initially", () => {
    render(<NewProjectForm onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /create project/i })).toBeDisabled();
  });

  it("submits correct payload via direct URL input and blur", async () => {
    const onSubmit = vi.fn();
    render(<NewProjectForm onSubmit={onSubmit} />);

    // Fill name
    fireEvent.change(screen.getByPlaceholderText("my-project"), {
      target: { value: "test-project" },
    });

    // Fill URL + trigger detection
    const urlInput = screen.getByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(urlInput, { target: { value: "https://github.com/user/repo" } });
    fireEvent.blur(urlInput);

    // Poll for button enabled (max 2s for debounce)
    const btn = screen.getByRole("button", { name: /create project/i });
    await vi.waitFor(
      () => expect(btn).not.toBeDisabled(),
      { timeout: 2000, interval: 50 }
    );

    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "test-project",
      sourceKind: "github",
      sourceRef: "https://github.com/user/repo",
    });
  });

  it("shows loading spinner when loading", () => {
    render(<NewProjectForm onSubmit={() => {}} loading={true} />);
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });
});
