/**
 * tests/unit/NewScanModal.test.tsx
 *
 * Unit tests for the NewScanModal component.
 * Tests rendering, visibility, step logic, and cancel behaviour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewScanModal } from "@/components/modals/NewScanModal";

// ── Module mocks ──────────────────────────────────────────────────────────────

// next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// next-intl — provide t() that echoes the key
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// SourceInput — lightweight stub so we don't need the full source tree
vi.mock("@/components/source/SourceInput", () => ({
  SourceInput: ({
    onValidationChange,
  }: {
    onValidationChange?: (valid: boolean) => void;
  }) => (
    <div data-testid="source-input">
      <button
        type="button"
        data-testid="make-valid"
        onClick={() => onValidationChange?.(true)}
      >
        make valid
      </button>
    </div>
  ),
}));

// ScanConfig — lightweight stub
vi.mock("@/components/project/ScanConfig", () => ({
  ScanConfig: ({ onSubmit }: { onSubmit: (data: object) => void }) => (
    <button
      data-testid="start-scan"
      onClick={() => onSubmit({ intensity: "standard", scanGitHistory: true, scanDependencies: true })}
    >
      Start Scan
    </button>
  ),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NewScanModal", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    onOpenChange.mockClear();
  });

  it("renders when open=true", () => {
    render(<NewScanModal open={true} onOpenChange={onOpenChange} />);
    expect(screen.getByText("New scan")).toBeInTheDocument();
  });

  it("does not render dialog content when open=false", () => {
    render(<NewScanModal open={false} onOpenChange={onOpenChange} />);
    expect(screen.queryByText("New scan")).not.toBeInTheDocument();
  });

  it("shows step 1 (source input) by default", () => {
    render(<NewScanModal open={true} onOpenChange={onOpenChange} />);
    expect(screen.getByTestId("source-input")).toBeInTheDocument();
  });

  it("Cancel button calls onOpenChange(false)", () => {
    render(<NewScanModal open={true} onOpenChange={onOpenChange} />);
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
