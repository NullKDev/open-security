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

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/scans/scan-1",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock the new components to verify they are mounted
vi.mock("@/components/ui/ToolCallBlock", () => ({
  ToolCallBlock: (props: { toolName: string; toolCallId: string; input: unknown; result?: unknown; isError?: boolean }) => (
    <div data-testid={`tool-call-block-${props.toolCallId}`} data-toolname={props.toolName} data-iserror={props.isError ? "true" : "false"}>
      ToolCall:{props.toolName}
    </div>
  ),
}));

vi.mock("@/components/ui/CostBadge", () => ({
  CostBadge: (props: { inputTokens: number; outputTokens: number; costUsd?: number }) => (
    <div data-testid="cost-badge">Cost: {props.inputTokens}/{props.outputTokens}</div>
  ),
}));

vi.mock("@/components/ui/PlanBlock", () => ({
  PlanBlock: (props: { steps: Array<{ title: string; status: string }> }) => (
    <div data-testid="plan-block">
      {props.steps.map((s, i) => <span key={i}>{s.title}</span>)}
    </div>
  ),
}));

vi.mock("@/components/ui/TerminalOutputBlock", () => ({
  TerminalOutputBlock: (props: { command?: string; output: string; exitCode?: number }) => (
    <div data-testid="terminal-block" data-exitcode={props.exitCode}>
      Out:{props.output}
    </div>
  ),
}));

vi.mock("@/components/ui/PermissionDialog", () => ({
  PermissionDialog: (props: { requestId: string; toolName: string; input: unknown; timeoutMs: number; scanId: string; onSettled: () => void }) => (
    <div data-testid="permission-dialog" data-toolname={props.toolName}>
      Perm:{props.toolName}
    </div>
  ),
}));

// Mock existing components
vi.mock("@/components/ui/ThinkingBlock", () => ({
  ThinkingBlock: (props: { text: string }) => <div data-testid="thinking-block">{props.text}</div>,
}));

const originalFetch = globalThis.fetch;

import ScanProgress from "@/app/scans/[id]/ScanProgress";

function emitEvent(es: MockEventSource, data: unknown) {
  es.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(data) }),
  );
}

describe("ScanProgress (rich ACP events)", () => {
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
          scanMode: "standard",
          children: [],
        },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── tool_call event → ToolCallBlock ─────────────────────────────────────

  it("renders ToolCallBlock on tool_call SSE event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "tool_call",
        toolName: "read_file",
        toolCallId: "tc-aaa",
        input: { path: "/app/page.tsx" },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("tool-call-block-tc-aaa")).toBeInTheDocument();
      expect(screen.getByTestId("tool-call-block-tc-aaa")).toHaveAttribute("data-toolname", "read_file");
    });
  });

  it("does NOT show PermissionDialog initially (no permission_request event)", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    // PermissionDialog mock should not be in the DOM yet
    expect(screen.queryByTestId("permission-dialog")).not.toBeInTheDocument();
  });

  // ─── tool_result event → appended to matching ToolCallBlock ──────────────

  it("updates ToolCallBlock when tool_result arrives for same toolCallId", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "tc-bbb",
        input: { cmd: "ls" },
      });
      emitEvent(mockEventSourceInstances[0], {
        type: "tool_result",
        toolCallId: "tc-bbb",
        output: "file1 file2",
        isError: false,
      });
    });

    await waitFor(() => {
      // The ToolCallBlock should still exist (with updated isError=false)
      const block = screen.getByTestId("tool-call-block-tc-bbb");
      expect(block).toBeInTheDocument();
      expect(block).toHaveAttribute("data-iserror", "false");
    });
  });

  it("sets error state on ToolCallBlock when tool_result isError=true", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "tool_call",
        toolName: "danger_command",
        toolCallId: "tc-ccc",
        input: { cmd: "rm -rf /" },
      });
      emitEvent(mockEventSourceInstances[0], {
        type: "tool_result",
        toolCallId: "tc-ccc",
        output: "Permission denied",
        isError: true,
      });
    });

    await waitFor(() => {
      const block = screen.getByTestId("tool-call-block-tc-ccc");
      expect(block).toHaveAttribute("data-iserror", "true");
    });
  });

  // ─── cost event → CostBadge ─────────────────────────────────────────────

  it("renders CostBadge on cost SSE event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "cost",
        inputTokens: 8000,
        outputTokens: 2000,
        costUsd: 0.0456,
      });
    });

    await waitFor(() => {
      const badge = screen.getByTestId("cost-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("8000/2000");
    });
  });

  // ─── plan event → PlanBlock ─────────────────────────────────────────────

  it("renders PlanBlock on plan SSE event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "plan",
        steps: [
          { title: "Analyze", status: "done" },
          { title: "Scan", status: "in_progress" },
        ],
      });
    });

    await waitFor(() => {
      const planBlock = screen.getByTestId("plan-block");
      expect(planBlock).toBeInTheDocument();
      expect(planBlock).toHaveTextContent("Analyze");
      expect(planBlock).toHaveTextContent("Scan");
    });
  });

  // ─── terminal_output event → TerminalOutputBlock ────────────────────────

  it("renders TerminalOutputBlock on terminal_output SSE event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "terminal_output",
        command: "npm test",
        output: "PASS 12 tests",
        exitCode: 0,
      });
    });

    await waitFor(() => {
      const terminalBlock = screen.getByTestId("terminal-block");
      expect(terminalBlock).toBeInTheDocument();
      expect(terminalBlock).toHaveTextContent("PASS 12 tests");
      expect(terminalBlock).toHaveAttribute("data-exitcode", "0");
    });
  });

  // ─── file_read event → inline annotation ────────────────────────────────

  it("renders inline annotation for file_read event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "file_read",
        path: "/src/app.tsx",
        preview: "import React",
      });
    });

    await waitFor(() => {
      // File path should be visible in the console/log area
      expect(screen.getByText("/src/app.tsx")).toBeInTheDocument();
    });
  });

  it("renders inline annotation for file_write event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "file_write",
        path: "/out/report.json",
        preview: '{"ok":true}',
      });
    });

    await waitFor(() => {
      expect(screen.getByText("/out/report.json")).toBeInTheDocument();
    });
  });

  // ─── server_info event → inline annotation ──────────────────────────────

  it("renders inline annotation for server_info event", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    await act(async () => {
      emitEvent(mockEventSourceInstances[0], {
        type: "server_info",
        agentId: "gemini",
        agentVersion: "2.5.0",
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/gemini/)).toBeInTheDocument();
    });
  });

  // ─── No .obt literals in ScanProgress ───────────────────────────────────

  it("does not contain .obt string literals", async () => {
    render(<ScanProgress scanId="scan-1" />);

    await waitFor(() => {
      expect(mockEventSourceInstances.length).toBe(1);
    });

    const html = document.body.innerHTML;
    expect(html).not.toContain(".obt");
  });
});
