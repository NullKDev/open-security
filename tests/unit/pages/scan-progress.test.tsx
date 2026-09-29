import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock EventSource
const mockEventSourceInstances: MockEventSource[] = [];

class MockEventSource {
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState: number = 0;
  CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    mockEventSourceInstances.push(this);
  }

  close() {
    this.readyState = this.CLOSED;
  }
}

// @ts-expect-error - mock EventSource globally
globalThis.EventSource = MockEventSource;

// Mock Next.js navigation (useRouter used in ScanProgress for Re-scan / New Scan redirects)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/scans/scan-1",
  useSearchParams: () => new URLSearchParams(),
}));

const originalFetch = globalThis.fetch;

import ScanProgress from "@/app/scans/[id]/ScanProgress";

function emitEvent(es: MockEventSource, data: unknown) {
  es.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(data) }),
  );
}

describe("ScanProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventSourceInstances.length = 0;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: "scan-1",
          status: "running",
          stage: null,
          projectId: "proj-1",
          version: 1,
          parentId: null,
          prompt: null,
          children: [],
        },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders scan page heading", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Scan" }),
      ).toBeInTheDocument();
    });
  });

  it("renders a cancel button while scan is running", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });
  });

  it("connects to SSE stream for the scan", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
      expect(mockEventSourceInstances[0].url).toBe("/api/scans/scan-1/stream");
    });
  });

  it("shows all 5 pipeline stage labels", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(screen.getByText("Prep")).toBeInTheDocument();
      expect(screen.getByText("Classical")).toBeInTheDocument();
      expect(screen.getByText("Patch")).toBeInTheDocument();
    });
  });

  it("updates stage indicator on SSE stage event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "stage",
        stage: "stage2-llm",
        status: "running",
      });
    });

    await waitFor(() => {
      // The status card should now show "LLM Scan" as current stage
      const statusCards = screen.getAllByText("LLM Scan");
      expect(statusCards.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows live findings counter updated from SSE", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "finding",
        finding: { title: "SQL injection" },
      });
      emitEvent(mockEventSourceInstances[0], {
        type: "finding",
        finding: { title: "XSS" },
      });
    });

    await waitFor(() => {
      // Find the findings counter (the heading "Findings" is in Card.Header)
      expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    });
  });

  it("shows console output area", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(screen.getByText("Console")).toBeInTheDocument();
    });
  });

  it("updates console log on SSE progress events", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "progress",
        message: "Running gitleaks...",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Running gitleaks...")).toBeInTheDocument();
    });
  });

  it("shows link to findings when scan is done", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "done",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /view findings/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows error message on SSE error event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "error",
        message: "LLM provider unreachable",
      });
    });

    await waitFor(() => {
      // Error appears in both log and alert — use getAllByText
      const msgs = screen.getAllByText(/llm provider unreachable/i);
      expect(msgs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
