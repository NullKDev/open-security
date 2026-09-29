import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocalMode } from "../LocalMode";

/**
 * Create a mock File with a specific size.
 */
function createMockFile(
  name: string,
  size: number,
  type: string,
  webkitRelativePath?: string,
): File {
  const content = new Array(Math.min(size, 1024)).fill("x").join("");
  const file = new File([content], name, { type });
  Object.defineProperty(file, "size", { value: size, writable: false });
  if (webkitRelativePath !== undefined) {
    Object.defineProperty(file, "webkitRelativePath", {
      value: webkitRelativePath,
      writable: false,
    });
  }
  return file;
}

/**
 * jsdom does NOT have DataTransfer in its global scope.
 */
function mockDataTransfer(files: File[]): Record<string, unknown> {
  return {
    types: ["Files"],
    files,
    items: {
      length: files.length,
      0: files[0] ? { kind: "file", getAsFile: () => files[0] } : undefined,
      1: files[1] ? { kind: "file", getAsFile: () => files[1] } : undefined,
      [Symbol.iterator]: function* () {
        for (const f of files) yield { kind: "file", getAsFile: () => f };
      },
    },
    getData: () => "",
  };
}

/**
 * jsdom does NOT support webkitdirectory detection.
 * "webkitdirectory" in HTMLInputElement returns false.
 * Therefore, in jsdom tests, LocalMode ALWAYS renders
 * the manual "Enter folder path" text input fallback for
 * folder mode — the "Choose Folder" button is never shown.
 *
 * ZIP mode works normally since it doesn't depend on
 * webkitdirectory.
 */

describe("LocalMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Renders drop zone (no mode prop — handles both) ──────────

  it("renders drop zone with instruction text", () => {
    render(<LocalMode onSelect={vi.fn()} />);

    expect(
      screen.getByText(/Drag a folder or .zip file/i),
    ).toBeInTheDocument();
    // jsdom: webkitdirectory unsupported → manual fallback shown
    expect(screen.getByPlaceholderText("/path/to/project")).toBeInTheDocument();
    expect(screen.getByText("Enter folder path")).toBeInTheDocument();
  });

  it("renders both Choose Folder fallback and Choose ZIP File buttons", () => {
    render(<LocalMode onSelect={vi.fn()} />);

    // jsdom: "Choose Folder" not shown (webkitdirectory unsupported),
    // but "Enter folder path" fallback and "Choose ZIP File" are shown
    expect(screen.getByText("Enter folder path")).toBeInTheDocument();
    expect(screen.getByText("Choose ZIP File")).toBeInTheDocument();
  });

  // ── 2. Idle state ──────────────────────────────────────────────

  it("shows nothing selected in idle state", () => {
    render(<LocalMode onSelect={vi.fn()} />);

    expect(
      screen.getByText(/Drag a folder or .zip file/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Change selection")).not.toBeInTheDocument();
  });

  // ── 3. Folder path input (manual fallback in jsdom) ─────────────

  it("shows selected folder path after manual input", () => {
    const onSelect = vi.fn();
    render(<LocalMode onSelect={onSelect} />);

    const input = screen.getByLabelText("Folder path");
    fireEvent.change(input, { target: { value: "/Users/project" } });

    expect(onSelect).toHaveBeenCalledWith("/Users/project", "local");
  });

  // ── 4. ZIP filename after picker ────────────────────────────────

  it("shows selected ZIP filename after ZIP picker", async () => {
    const onSelect = vi.fn();
    const { container } = render(<LocalMode onSelect={onSelect} />);

    const zipInput = container.querySelector(
      'input[type="file"][accept=".zip"]',
    ) as HTMLInputElement;
    const file = createMockFile("project.zip", 5000, "application/zip");

    await userEvent.setup().upload(zipInput, file);

    expect(screen.getByText("project.zip")).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith("project.zip", "zip");
  });

  // ── 5. Drag-over visual state ──────────────────────────────────

  it("shows drag-over visual state when dragging over drop zone", async () => {
    render(<LocalMode onSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop folder or ZIP file, or click to browse",
    });

    const dummyFile = new File(["test"], "test.zip", {
      type: "application/zip",
    });

    await act(async () => {
      fireEvent.dragEnter(dropZone, {
        dataTransfer: mockDataTransfer([dummyFile]),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Drop here")).toBeInTheDocument();
    });
  });

  // ── 6. 200 MB warning (ZIP > 200 MB) ───────────────────────────

  it("shows 200 MB warning when ZIP file exceeds 200 MB", async () => {
    const onSelect = vi.fn();
    const { container } = render(<LocalMode onSelect={onSelect} />);

    const zipInput = container.querySelector(
      'input[type="file"][accept=".zip"]',
    ) as HTMLInputElement;
    const largeFile = createMockFile(
      "large.zip",
      209_715_201,
      "application/zip",
    );

    await userEvent.setup().upload(zipInput, largeFile);

    expect(screen.getByText(/Source exceeds 200 MB/i)).toBeInTheDocument();
    expect(screen.getByText("large.zip")).toBeInTheDocument();
  });

  // ── 7. No warning for small ZIP ─────────────────────────────────

  it("does not show 200 MB warning when ZIP file is under 200 MB", async () => {
    const onSelect = vi.fn();
    const { container } = render(<LocalMode onSelect={onSelect} />);

    const zipInput = container.querySelector(
      'input[type="file"][accept=".zip"]',
    ) as HTMLInputElement;
    const smallFile = createMockFile("small.zip", 50_000, "application/zip");

    await userEvent.setup().upload(zipInput, smallFile);

    expect(screen.getByText("small.zip")).toBeInTheDocument();
    expect(
      screen.queryByText(/Source exceeds 200 MB/i),
    ).not.toBeInTheDocument();
  });

  // ── 8. File drop triggers 200 MB warning ──────────────────────

  it("shows 200 MB warning when large ZIP is dropped on drop zone", async () => {
    const onSelect = vi.fn();
    render(<LocalMode onSelect={onSelect} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop folder or ZIP file, or click to browse",
    });

    const largeFile = createMockFile(
      "bigdrop.zip",
      209_715_201,
      "application/zip",
    );

    fireEvent.drop(dropZone, { dataTransfer: mockDataTransfer([largeFile]) });

    await waitFor(() => {
      expect(screen.getByText("bigdrop.zip")).toBeInTheDocument();
    });

    expect(screen.getByText(/Source exceeds 200 MB/i)).toBeInTheDocument();
  });

  // ── 9. Manual path input fallback (webkitdirectory unsupported) ─

  it("shows manual path input when webkitdirectory is unsupported", () => {
    render(<LocalMode onSelect={vi.fn()} />);

    expect(screen.getByLabelText("Folder path")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("/path/to/project")).toBeInTheDocument();
    expect(screen.getByText("Enter folder path")).toBeInTheDocument();

    // "Choose Folder" button should NOT be present in jsdom
    expect(screen.queryByText("Choose Folder")).not.toBeInTheDocument();
  });

  // ── 10. ZIP picker button triggers file input ──────────────────

  it("ZIP picker button triggers hidden file input click", async () => {
    render(<LocalMode onSelect={vi.fn()} />);

    const chooseBtn = screen.getByText("Choose ZIP File");
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");

    await userEvent.setup().click(chooseBtn);

    expect(clickSpy).toHaveBeenCalled();
  });

  // ── 11. ARIA roles and labels ──────────────────────────────────

  it("has ARIA role button and accessible label on drop zone", () => {
    render(<LocalMode onSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop folder or ZIP file, or click to browse",
    });
    expect(dropZone).toBeInTheDocument();
    expect(dropZone).toHaveAttribute("tabindex", "0");
  });

  it("has drag error with role alert", () => {
    render(<LocalMode onSelect={vi.fn()} error="Test error" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Test error");
  });

  it("size warning uses role status for polite announcement", async () => {
    const onSelect = vi.fn();
    const { container } = render(<LocalMode onSelect={onSelect} />);

    const zipInput = container.querySelector(
      'input[type="file"][accept=".zip"]',
    ) as HTMLInputElement;
    const largeFile = createMockFile(
      "large.zip",
      209_715_201,
      "application/zip",
    );

    await userEvent.setup().upload(zipInput, largeFile);

    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent(/Source exceeds 200 MB/i);
    expect(warning).toHaveAttribute("aria-live", "polite");
  });

  // ── 12. Keyboard accessibility ─────────────────────────────────
  // Note: In jsdom, webkitdirectory is unsupported so folderInputRef
  // is never mounted. Keyboard presses are no-ops in jsdom.
  // These tests verify the handler exists and doesn't crash.

  it("handles Enter key on drop zone without crashing (no webkitdirectory in jsdom)", () => {
    render(<LocalMode onSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop folder or ZIP file, or click to browse",
    });

    // Should not throw
    expect(() => {
      fireEvent.keyDown(dropZone, { key: "Enter" });
    }).not.toThrow();
  });

  it("handles Space key on drop zone without crashing (no webkitdirectory in jsdom)", () => {
    render(<LocalMode onSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop folder or ZIP file, or click to browse",
    });

    // Should not throw
    expect(() => {
      fireEvent.keyDown(dropZone, { key: " " });
    }).not.toThrow();
  });

  // ── Edge case: Change selection clears state ───────────────────

  it("clears selection and warning when Change selection is clicked", async () => {
    const onSelect = vi.fn();
    const { container } = render(<LocalMode onSelect={onSelect} />);

    const zipInput = container.querySelector(
      'input[type="file"][accept=".zip"]',
    ) as HTMLInputElement;
    const largeFile = createMockFile(
      "large.zip",
      209_715_201,
      "application/zip",
    );
    await userEvent.setup().upload(zipInput, largeFile);

    expect(screen.getByText("large.zip")).toBeInTheDocument();
    expect(screen.getByText(/Source exceeds 200 MB/i)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByText("Change selection"));

    expect(
      screen.queryByText(/Source exceeds 200 MB/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("large.zip")).not.toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith("", "zip");
  });

  // ── Drag error on invalid file ────────────────────────────────

  it("shows drag error when invalid file is dropped", async () => {
    render(<LocalMode onSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button", {
      name: "Drop folder or ZIP file, or click to browse",
    });

    const invalidFile = new File(["content"], "archive.tar.gz", {
      type: "application/gzip",
    });

    fireEvent.drop(dropZone, { dataTransfer: mockDataTransfer([invalidFile]) });

    await waitFor(() => {
      expect(
        screen.getByText(/Only .zip files and folders accepted/i),
      ).toBeInTheDocument();
    });
  });

  // ── Manual path input calls onSelect ──────────────────────────

  it("manual path input calls onSelect with typed value", () => {
    const onSelect = vi.fn();
    render(<LocalMode onSelect={onSelect} />);

    const input = screen.getByLabelText("Folder path");
    fireEvent.change(input, { target: { value: "/home/user/myapp" } });

    expect(onSelect).toHaveBeenCalledWith("/home/user/myapp", "local");
  });
});
