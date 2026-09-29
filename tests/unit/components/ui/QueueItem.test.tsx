import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueueRowDTO } from "@/lib/repos/queue.repo";

// Mock next/navigation before importing the component
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { QueueItem } from "@/components/ui/QueueItem";

function makeFinding(overrides: Partial<QueueRowDTO> = {}): QueueRowDTO {
  return {
    id: "finding-1",
    scanId: "scan-1",
    projectId: "proj-1",
    projectName: "my-repo",
    detector: "gitleaks",
    severity: "high",
    title: "AWS Secret Key",
    locationPath: "config.yaml",
    dedupKey: "abc123",
    occurrenceCount: 1,
    firstDetectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    lastSeenAt: null,
    cveIds: null,
    patchDiff: null,
    epssScore: null,
    cisaKev: 0,
    daysOpen: 3,
    rankScore: 0.5,
    exploitability: 1,
    ...overrides,
  };
}

describe("QueueItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the finding title", () => {
    render(<QueueItem finding={makeFinding()} />);
    expect(screen.getByText("AWS Secret Key")).toBeInTheDocument();
  });

  it("renders severity badge", () => {
    render(<QueueItem finding={makeFinding({ severity: "critical" })} />);
    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it("renders EPSS score when present", () => {
    render(<QueueItem finding={makeFinding({ epssScore: 0.73 })} />);
    expect(screen.getByText("73.00%")).toBeInTheDocument();
  });

  it("does not render EPSS when epssScore is null", () => {
    render(<QueueItem finding={makeFinding({ epssScore: null })} />);
    expect(screen.queryByText(/EPSS/)).not.toBeInTheDocument();
  });

  it("renders KEV badge when cisaKev is 1", () => {
    render(<QueueItem finding={makeFinding({ cisaKev: 1 })} />);
    expect(screen.getByText("KEV")).toBeInTheDocument();
  });

  it("does not render KEV badge when cisaKev is 0", () => {
    render(<QueueItem finding={makeFinding({ cisaKev: 0 })} />);
    expect(screen.queryByText("KEV")).not.toBeInTheDocument();
  });

  it("renders project name", () => {
    render(<QueueItem finding={makeFinding({ projectName: "my-project" })} />);
    expect(screen.getByText(/my-project/)).toBeInTheDocument();
  });

  it("shows Confirm fix button when patchDiff is present and no branch", () => {
    render(
      <QueueItem finding={makeFinding({ patchDiff: "diff content" })} branchStatus={null} />
    );
    expect(screen.getByRole("button", { name: /confirm fix/i })).toBeInTheDocument();
  });

  it("does not show Confirm fix when no patchDiff", () => {
    render(<QueueItem finding={makeFinding({ patchDiff: null })} />);
    expect(screen.queryByRole("button", { name: /confirm fix/i })).not.toBeInTheDocument();
  });

  it("always shows Dismiss button", () => {
    render(<QueueItem finding={makeFinding()} />);
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("shows occurrence count when greater than 1", () => {
    render(<QueueItem finding={makeFinding({ occurrenceCount: 5 })} />);
    expect(screen.getByText(/seen 5 times/i)).toBeInTheDocument();
  });

  it("does not show occurrence count when exactly 1", () => {
    render(<QueueItem finding={makeFinding({ occurrenceCount: 1 })} />);
    expect(screen.queryByText(/seen.*times/i)).not.toBeInTheDocument();
  });

  it("renders age from firstDetectedAt", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    render(<QueueItem finding={makeFinding({ firstDetectedAt: threeDaysAgo })} />);
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
  });

  it("shows DismissDialog when Dismiss is clicked", async () => {
    const user = userEvent.setup();
    render(<QueueItem finding={makeFinding()} />);
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    // Dialog description should appear
    expect(screen.getByText(/false positive/i)).toBeInTheDocument();
  });
});
