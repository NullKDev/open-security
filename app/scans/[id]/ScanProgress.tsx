"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThinkingBlock } from "@/components/ui/ThinkingBlock";
import { ResponseBlock } from "@/components/ui/ResponseBlock";
import { StatusPill } from "@/components/ui/StatusPill";
import { ScanModePicker } from "@/components/ui/ScanModePicker";
import { ToolCallBlock } from "@/components/ui/ToolCallBlock";
import { CostBadge } from "@/components/ui/CostBadge";
import { PlanBlock } from "@/components/ui/PlanBlock";
import { TerminalOutputBlock } from "@/components/ui/TerminalOutputBlock";
import { PermissionDialog } from "@/components/ui/PermissionDialog";
import { SarifExportButton } from "@/components/sarif/SarifExportButton";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { ScanMode } from "@/lib/repos/scans.repo";
import type { ToolKind } from "@agentclientprotocol/sdk";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES = [
  { key: "stage0-prep", label: "Prep" },
  { key: "stage1-classical", label: "Classical" },
  { key: "stage2-llm", label: "LLM Scan" },
  { key: "stage3-validate", label: "Validate" },
  { key: "stage4-patch", label: "Patch" },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanStatus = "pending" | "running" | "done" | "failed" | "cancelled";

interface ScanMeta {
  version: number;
  parentId: string | null;
  prompt: string | null;
  projectId: string;
  scanMode: ScanMode;
}

// SSE event shapes
interface StageSSEvent { type: "stage"; stage: string; status?: "running" | "done" | "failed" }
interface FindingSSEvent { type: "finding"; finding: unknown }
interface ProgressSSEvent { type: "progress"; message: string }
interface ErrorSSEvent { type: "error"; message: string }
interface DoneSSEvent { type: "done" }
/** messageId groups streaming chunks into one message block (ACP UNSTABLE field). */
interface ThinkingSSEvent { type: "thinking"; text: string; format?: "markdown" | "plain"; messageId?: string }
interface ResponseSSEvent { type: "response"; text: string; format?: "markdown" | "plain"; messageId?: string }
interface MetaSSEvent { type: "meta"; providerId: string; transport_kind?: string; thinkingSupport?: boolean }
interface ToolCallSSEvent {
  type: "tool_call"; toolName: string; toolCallId: string; input: unknown;
  kind?: ToolKind;
  locations?: Array<{ path: string; line?: number }>;
}
interface ToolResultSSEvent { type: "tool_result"; toolCallId: string; output: unknown; isError?: boolean; diffs?: Array<{ path: string; newText: string; oldText?: string | null }> }
interface PermissionRequestSSEvent { type: "permission_request"; requestId: string; toolName: string; input: unknown; timeoutMs?: number }
interface CostSSEvent { type: "cost"; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number; contextSize?: number; contextUsed?: number }
interface StopReasonSSEvent { type: "stop_reason"; reason: string }
interface PlanSSEvent { type: "plan"; steps: Array<{ title: string; status: "pending" | "in_progress" | "done" | "error" }> }
interface TerminalOutputSSEvent { type: "terminal_output"; command?: string; output: string; exitCode?: number }
interface FileReadSSEvent { type: "file_read"; path: string; preview?: string }
interface FileWriteSSEvent { type: "file_write"; path: string; preview?: string }
interface ServerInfoSSEvent { type: "server_info"; agentId: string; agentVersion?: string }

type SSEvent =
  | StageSSEvent | FindingSSEvent | ProgressSSEvent | ErrorSSEvent | DoneSSEvent
  | ThinkingSSEvent | ResponseSSEvent | MetaSSEvent
  | ToolCallSSEvent | ToolResultSSEvent | PermissionRequestSSEvent
  | CostSSEvent | PlanSSEvent | TerminalOutputSSEvent
  | FileReadSSEvent | FileWriteSSEvent | ServerInfoSSEvent | StopReasonSSEvent;

/**
 * Ordered stream of events rendered as chat messages.
 * tool_call and tool_result are merged inline so they appear in sequence.
 * thinking and response are accumulated — fragments stream into one block each.
 */
type LogEntry =
  | { kind: "text"; text: string }
  | { kind: "thinking"; id: number; text: string; active: boolean; format?: "markdown" | "plain" }
  | { kind: "response"; id: number; text: string; active: boolean; format?: "markdown" | "plain" }
  | { kind: "tool_call"; toolCallId: string; toolName: string; toolKind?: ToolKind; locations?: Array<{ path: string; line?: number }>; input: unknown; result?: unknown; isError: boolean; diffs?: Array<{ path: string; newText: string; oldText?: string | null }> }
  | { kind: "plan"; steps: Array<{ title: string; status: "pending" | "in_progress" | "done" | "error" }> }
  | { kind: "terminal_output"; command?: string; output: string; exitCode?: number }
  | { kind: "file_read"; path: string; preview?: string }
  | { kind: "file_write"; path: string; preview?: string }
  | { kind: "server_info"; agentId: string; agentVersion?: string };

let nextId = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveStatusLabel(
  scanStatus: ScanStatus,
  currentStage: string | null,
  isThinking: boolean,
): string {
  if (scanStatus === "done") return "Complete";
  if (scanStatus === "failed") return "Error";
  if (scanStatus === "cancelled") return "Cancelled";
  if (isThinking) return "Thinking";
  if (currentStage) {
    const label = STAGES.find((s) => s.key === currentStage)?.label;
    return label ? `Running · ${label}` : "Running";
  }
  return "Initializing";
}

const MODE_STYLE: Record<ScanMode, string> = {
  quick: "bg-fg/5 text-fg/50",
  standard: "bg-accent/10 text-accent/70",
  intermediate: "bg-info/10 text-info/70",
  paranoid: "bg-warning/10 text-warning/80",
};

// ─── New Scan modal ───────────────────────────────────────────────────────────

interface NewScanModalProps {
  parentScanId: string;
  defaultMode: ScanMode;
  onClose: () => void;
  onCreated: (newScanId: string) => void;
}

function NewScanModal({ parentScanId, defaultMode, onClose, onCreated }: NewScanModalProps) {
  const [prompt, setPrompt] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>(defaultMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentScanId, prompt: prompt.trim() || undefined, scanMode }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error?.message || "Failed to create scan.");
        return;
      }
      onCreated(data.data.id);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-semibold text-fg">New Focused Scan</h2>
        <p className="text-sm text-fg/60">
          Create a new scan from the same source with a custom focus and mode.
        </p>
        <ScanModePicker value={scanMode} onChange={setScanMode} />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-fg/80">
            Focus prompt <span className="text-fg/40 font-normal">(optional)</span>
          </label>
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Only scan the authentication module"
            rows={3}
            maxLength={2000}
            className="w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:ring-1 focus:ring-accent/60"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" loading={loading} onClick={handleSubmit}>Start Scan</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline step (vertical stepper) ────────────────────────────────────────

interface PipelineStepProps {
  label: string;
  state: "pending" | "current" | "done" | "failed";
  isLast: boolean;
}

function PipelineStep({ label, state, isLast }: PipelineStepProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
            state === "done"
              ? "border-success bg-success/15 text-success"
              : state === "current"
                ? "border-accent bg-accent/15 text-accent ring-2 ring-accent/25 ring-offset-2 ring-offset-bg"
                : state === "failed"
                  ? "border-danger bg-danger/15 text-danger"
                  : "border-border bg-bg text-fg/30"
          }`}
        >
          {state === "done" ? (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : state === "failed" ? (
            "✗"
          ) : state === "current" ? (
            <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
          ) : null}
        </div>
        {!isLast && (
          <div
            className={`mt-1 w-px flex-1 min-h-5 ${
              state === "done" ? "bg-success/30" : "bg-border/40"
            }`}
          />
        )}
      </div>
      <div className="pb-4 pt-0.5">
        <span
          className={`text-sm font-medium ${
            state === "done"
              ? "text-success"
              : state === "current"
                ? "text-accent"
                : state === "failed"
                  ? "text-danger"
                  : "text-fg/40"
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Chat message sub-components ──────────────────────────────────────────────

function SystemMessage({ text }: { text: string }) {
  const isSuccess = text.startsWith("✓");
  const isError = text.startsWith("✗");
  return (
    <div
      className={`flex items-center gap-3 py-0.5 text-xs ${
        isSuccess ? "text-success/70" : isError ? "text-danger/70" : "text-fg/30"
      }`}
    >
      <div className="h-px flex-1 bg-current opacity-30" />
      <span className="shrink-0">{text}</span>
      <div className="h-px flex-1 bg-current opacity-30" />
    </div>
  );
}

function AgentBanner({ agentId, agentVersion }: { agentId: string; agentVersion?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-sm">
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
      <span className="font-semibold text-fg">{agentId}</span>
      {agentVersion && (
        <span className="text-[11px] text-fg/40">v{agentVersion}</span>
      )}
      <span className="ml-auto text-xs text-fg/40">Agent connected</span>
    </div>
  );
}

function FileAnnotation({ kind, path }: { kind: "file_read" | "file_write"; path: string }) {
  return (
    <div className="inline-flex w-fit items-center gap-1.5 rounded border border-border/50 bg-surface/60 px-2 py-0.5 font-mono text-[11px] text-fg/50">
      <span className={kind === "file_read" ? "text-info/60" : "text-warning/60"}>
        {kind === "file_read" ? "📄" : "✎"}
      </span>
      <span>{kind === "file_read" ? "read" : "wrote"}</span>
      <span className="text-fg/40">{path}</span>
    </div>
  );
}

// ─── LogFeed: renders all LLM stream entries ──────────────────────────────────

interface LogFeedProps {
  log: LogEntry[];
  stopReason: string | null;
  error: string | null;
  logEndRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Renders the ordered stream of LLM log entries.
 * Extracted so it can be reused in both the desktop resizable panel
 * and the mobile vertical-stack fallback without duplication.
 */
function LogFeed({ log, stopReason, error, logEndRef }: LogFeedProps) {
  return (
    <>
      {log.length === 0 && (
        <div className="flex items-center gap-2 py-8 text-sm text-fg/30">
          <span className="animate-pulse">●</span>
          <span>Waiting for scan output…</span>
        </div>
      )}

      {log.map((entry, i) => {
        switch (entry.kind) {
          case "server_info":
            return (
              <AgentBanner
                key={`srv-${i}`}
                agentId={entry.agentId}
                agentVersion={entry.agentVersion}
              />
            );

          case "thinking":
            return (
              <ThinkingBlock
                key={`thinking-${entry.id}`}
                text={entry.text}
                active={entry.active}
                format={entry.format}
              />
            );

          case "response":
            return (
              <ResponseBlock
                key={`response-${entry.id}`}
                text={entry.text}
                active={entry.active}
              />
            );

          case "tool_call":
            return (
              <ToolCallBlock
                key={`tool-${entry.toolCallId}`}
                toolName={entry.toolName}
                toolCallId={entry.toolCallId}
                kind={entry.toolKind}
                locations={entry.locations}
                input={entry.input}
                result={entry.result}
                isError={entry.isError}
                diffs={entry.diffs}
              />
            );

          case "plan":
            return <PlanBlock key={`plan-${i}`} steps={entry.steps} />;

          case "terminal_output":
            return (
              <TerminalOutputBlock
                key={`term-${i}`}
                command={entry.command}
                output={entry.output}
                exitCode={entry.exitCode}
              />
            );

          case "file_read":
            return <FileAnnotation key={`fr-${i}`} kind="file_read" path={entry.path} />;

          case "file_write":
            return <FileAnnotation key={`fw-${i}`} kind="file_write" path={entry.path} />;

          case "text":
            return <SystemMessage key={`txt-${i}`} text={entry.text} />;

          default:
            return null;
        }
      })}

      {stopReason && stopReason !== "end_turn" && (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3 flex items-start gap-2.5">
          <span className="text-warning/80 text-sm mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-medium text-warning/90">
              {stopReason === "max_tokens" && "Output truncated — agent hit the token limit"}
              {stopReason === "max_turn_requests" && "Truncated — agent hit the max turn request limit"}
              {stopReason === "refusal" && "Agent refused to continue"}
              {stopReason === "cancelled" && "Scan was cancelled"}
              {!["max_tokens", "max_turn_requests", "refusal", "cancelled"].includes(stopReason) &&
                `Agent stopped: ${stopReason}`}
            </p>
            <p className="text-xs text-warning/60 mt-0.5">The scan result may be incomplete.</p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm font-medium text-danger">{error}</p>
        </div>
      )}

      <div ref={logEndRef} />
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function ScanProgress({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<ScanStatus>("running");
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [findingsCount, setFindingsCount] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [showNewScanModal, setShowNewScanModal] = useState(false);
  const [scanMeta, setScanMeta] = useState<ScanMeta | null>(null);
  const [scanStartedAt] = useState(() => Date.now());
  const [providerMeta, setProviderMeta] = useState<{
    transportKind?: string;
    thinkingSupport?: boolean;
  } | null>(null);
  const [costInfo, setCostInfo] = useState<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd?: number;
    contextSize?: number;
    contextUsed?: number;
  } | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<{
    requestId: string;
    toolName: string;
    input: unknown;
    timeoutMs: number;
  } | null>(null);
  const [agentInfo, setAgentInfo] = useState<{ name: string; version?: string } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Refs for accumulating streaming chunks — avoids nested state updater calls
  // that cause double-invoke in React 18 StrictMode.
  // Each ref holds { id: number (log index key), messageId?: string }.
  const thinkingRef = useRef<{ id: number; messageId?: string } | null>(null);
  const responseRef = useRef<{ id: number; messageId?: string } | null>(null);

  const statusLabel = deriveStatusLabel(status, currentStage, isThinking);
  const isActive = status === "running" || status === "pending";
  const isDone = status === "done" || status === "failed" || status === "cancelled";
  const currentStageLabel = currentStage
    ? (STAGES.find((s) => s.key === currentStage)?.label ?? currentStage)
    : null;

  // Fetch initial scan data
  useEffect(() => {
    fetch(`/api/scans/${scanId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setStatus(d.data.status);
          setCurrentStage(d.data.stage);
          setScanMeta({
            version: d.data.version ?? 1,
            parentId: d.data.parentId ?? null,
            prompt: d.data.prompt ?? null,
            projectId: d.data.projectId,
            scanMode: d.data.scanMode ?? "standard",
          });
        }
      })
      .catch(() => {});
  }, [scanId]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource(`/api/scans/${scanId}/stream`);

    /** Mark active thinking block as complete and filter trivial fragments. */
    function completeActiveThinking() {
      const current = thinkingRef.current;
      if (!current) return;
      thinkingRef.current = null;
      setIsThinking(false);
      setLog((prev) =>
        prev
          .map((entry) =>
            entry.kind === "thinking" && entry.id === current.id
              ? { ...entry, active: false }
              : entry,
          )
          .filter((entry) => {
            if (entry.kind !== "thinking") return true;
            if (entry.active) return true;
            const t = entry.text.trim();
            return t.length > 3 && !/^[{}\[\],:"]+$/.test(t);
          }),
      );
    }

    /** Mark active response block as complete. */
    function completeActiveResponse() {
      const current = responseRef.current;
      if (!current) return;
      responseRef.current = null;
      setLog((prev) =>
        prev.map((entry) =>
          entry.kind === "response" && entry.id === current.id
            ? { ...entry, active: false }
            : entry,
        ),
      );
    }

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as SSEvent;
        switch (data.type) {
          case "stage":
            completeActiveThinking();
            completeActiveResponse();
            setCurrentStage(data.stage);
            if (data.status === "done") {
              setLog((prev) => [...prev, { kind: "text", text: `✓ Stage ${data.stage} completed` }]);
            } else if (data.status === "failed") {
              setLog((prev) => [...prev, { kind: "text", text: `✗ Stage ${data.stage} failed` }]);
            }
            break;

          case "thinking": {
            const text = data.text;
            if (!text || text.length === 0) break;
            // Group by messageId when available, otherwise accumulate into
            // the current active block until a non-thinking event resets it.
            const sameBlock = thinkingRef.current &&
              (!data.messageId || data.messageId === thinkingRef.current.messageId);
            if (sameBlock && thinkingRef.current) {
              const id = thinkingRef.current.id;
              setLog((prev) =>
                prev.map((entry) =>
                  entry.kind === "thinking" && entry.id === id
                    ? { ...entry, text: entry.text + text }
                    : entry,
                ),
              );
            } else {
              // New thinking block — complete previous if any
              completeActiveThinking();
              const id = nextId++;
              thinkingRef.current = { id, messageId: data.messageId };
              setIsThinking(true);
              setLog((prev) => [...prev, { kind: "thinking", id, text, active: true, format: data.format }]);
            }
            break;
          }

          case "response": {
            const text = data.text;
            if (!text || text.length === 0) break;
            // Same grouping logic as thinking: use messageId when available.
            const sameBlock = responseRef.current &&
              (!data.messageId || data.messageId === responseRef.current.messageId);
            if (sameBlock && responseRef.current) {
              const id = responseRef.current.id;
              setLog((prev) =>
                prev.map((entry) =>
                  entry.kind === "response" && entry.id === id
                    ? { ...entry, text: entry.text + text }
                    : entry,
                ),
              );
            } else {
              completeActiveResponse();
              const id = nextId++;
              responseRef.current = { id, messageId: data.messageId };
              setLog((prev) => [...prev, { kind: "response", id, text, active: true, format: data.format }]);
            }
            break;
          }

          case "progress":
            setLog((prev) => [...prev, { kind: "text", text: data.message }]);
            break;

          case "finding":
            setFindingsCount((prev) => prev + 1);
            break;

          case "error":
            completeActiveThinking();
            completeActiveResponse();
            setError(data.message);
            setStatus("failed");
            setLog((prev) => [...prev, { kind: "text", text: `✗ Error: ${data.message}` }]);
            es.close();
            break;

          case "meta":
            setProviderMeta({
              transportKind: data.transport_kind,
              thinkingSupport: data.thinkingSupport,
            });
            break;

          case "tool_call":
            // A new tool call resets response accumulation (new turn)
            completeActiveResponse();
            setLog((prev) => [
              ...prev,
              {
                kind: "tool_call",
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                toolKind: data.kind,
                locations: data.locations,
                input: data.input,
                isError: false,
              },
            ]);
            break;

          case "tool_result":
            setLog((prev) =>
              prev.map((entry) =>
                entry.kind === "tool_call" && entry.toolCallId === data.toolCallId
                  ? { ...entry, result: data.output, isError: data.isError ?? false, diffs: data.diffs }
                  : entry,
              ),
            );
            break;

          case "permission_request":
            setPendingPermission({
              requestId: data.requestId,
              toolName: data.toolName,
              input: data.input,
              timeoutMs: data.timeoutMs ?? 60000,
            });
            break;

          case "cost":
            setCostInfo({
              inputTokens: data.inputTokens,
              outputTokens: data.outputTokens,
              cacheReadTokens: data.cacheReadTokens,
              cacheWriteTokens: data.cacheWriteTokens,
              costUsd: data.costUsd,
              contextSize: data.contextSize,
              contextUsed: data.contextUsed,
            });
            break;

          case "stop_reason":
            setStopReason(data.reason);
            break;

          case "plan":
            setLog((prev) => [...prev, { kind: "plan", steps: data.steps }]);
            break;

          case "terminal_output":
            setLog((prev) => [
              ...prev,
              { kind: "terminal_output", command: data.command, output: data.output, exitCode: data.exitCode },
            ]);
            break;

          case "file_read":
            setLog((prev) => [...prev, { kind: "file_read", path: data.path, preview: data.preview }]);
            break;

          case "file_write":
            setLog((prev) => [...prev, { kind: "file_write", path: data.path, preview: data.preview }]);
            break;

          case "server_info":
            setAgentInfo({ name: data.agentId, version: data.agentVersion });
            setLog((prev) => [
              ...prev,
              { kind: "server_info", agentId: data.agentId, agentVersion: data.agentVersion },
            ]);
            break;

          case "done":
            completeActiveThinking();
            completeActiveResponse();
            setStatus("done");
            setLog((prev) => [...prev, { kind: "text", text: "✓ Scan complete" }]);
            es.close();
            break;
        }
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {};
    return () => es.close();
  }, [scanId]);

  // Auto-scroll chat feed on new events
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      await fetch(`/api/scans/${scanId}`, { method: "DELETE" });
      setStatus("cancelled");
      setLog((prev) => [...prev, { kind: "text" as const, text: "✗ Scan cancelled by user" }]);
    } catch {
      // Keep trying
    } finally {
      setCancelling(false);
    }
  }, [scanId]);

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentScanId: scanId,
          prompt: scanMeta?.prompt ?? undefined,
          scanMode: scanMeta?.scanMode ?? "standard",
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) router.push(`/scans/${data.data.id}`);
    } catch {
      // ignore
    } finally {
      setRescanning(false);
    }
  }, [scanId, scanMeta, router]);

  const handleNewScanCreated = useCallback((newId: string) => {
    setShowNewScanModal(false);
    router.push(`/scans/${newId}`);
  }, [router]);

  function stageState(key: string): "pending" | "current" | "done" | "failed" {
    if (status === "failed" && currentStage === key) return "failed";
    if (status === "done") return "done";
    if (currentStage === key) return "current";
    const currentIdx = STAGES.findIndex((s) => s.key === currentStage);
    const thisIdx = STAGES.findIndex((s) => s.key === key);
    if (currentIdx >= 0 && thisIdx < currentIdx) return "done";
    return "pending";
  }

  return (
    <>
      {/* ── Sticky status bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-8 mb-6 flex items-center justify-between gap-4 border-b border-border bg-bg/95 px-8 py-3 backdrop-blur-sm">
        {/* Left: identity + status */}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {agentInfo ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isActive ? "animate-pulse bg-accent" : "bg-fg/30"
                }`}
              />
              <span className="max-w-[12rem] truncate text-sm font-semibold text-fg">
                {agentInfo.name}
              </span>
              {agentInfo.version && (
                <span className="text-[11px] text-fg/40">v{agentInfo.version}</span>
              )}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isActive ? "animate-pulse bg-fg/30" : "bg-fg/20"
                }`}
              />
              <span className="text-sm text-fg/50">Scan</span>
            </div>
          )}

          <StatusPill
            label={statusLabel}
            startedAt={isActive ? scanStartedAt : undefined}
            done={isDone}
          />

          {currentStageLabel && (
            <span className="hidden text-xs text-fg/40 sm:block">{currentStageLabel}</span>
          )}

          <span className="text-xs font-medium text-fg/60">
            {findingsCount} finding{findingsCount !== 1 ? "s" : ""}
          </span>

          {costInfo && <CostBadge {...costInfo} />}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-2">
          {isActive && (
            <Button variant="danger" size="sm" loading={cancelling} onClick={handleCancel}>
              Cancel
            </Button>
          )}
          {isDone && (
            <>
              <Button variant="secondary" size="sm" loading={rescanning} onClick={handleRescan}>
                Re-scan
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowNewScanModal(true)}>
                New Scan
              </Button>
            </>
          )}
          {status === "done" && (
            <>
              <Link href={`/scans/${scanId}/findings`}>
                <Button variant="primary" size="sm">View Findings</Button>
              </Link>
              <SarifExportButton scanId={scanId} />
            </>
          )}
        </div>
      </div>

      {/* ── Two-column resizable layout (desktop md+) ─────────────────────── */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="hidden md:flex h-[calc(100vh-8rem)]"
      >
        {/* LEFT PANEL: Pipeline + metadata */}
        <ResizablePanel defaultSize={40} minSize={25}>
          <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
            {/* Pipeline steps */}
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-fg/40">
                Pipeline
              </p>
              {STAGES.map((stage, idx) => (
                <PipelineStep
                  key={stage.key}
                  label={stage.label}
                  state={stageState(stage.key)}
                  isLast={idx === STAGES.length - 1}
                />
              ))}
            </div>

            {/* Scan metadata */}
            {scanMeta && (
              <div className="space-y-2 border-t border-border/40 pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg/40">Mode</span>
                  <span className={`rounded px-1.5 py-0.5 font-medium ${MODE_STYLE[scanMeta.scanMode]}`}>
                    {scanMeta.scanMode}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg/40">Version</span>
                  <span className="font-mono text-fg/60">v{scanMeta.version}</span>
                </div>
                {providerMeta?.thinkingSupport !== undefined && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg/40">Thinking</span>
                    <span className={providerMeta.thinkingSupport ? "text-accent/70" : "text-fg/30"}>
                      {providerMeta.thinkingSupport ? "enabled" : "off"}
                    </span>
                  </div>
                )}
                {providerMeta?.transportKind && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg/40">Transport</span>
                    <span className="font-mono text-[10px] text-fg/40">{providerMeta.transportKind}</span>
                  </div>
                )}
              </div>
            )}

            {/* Context window bar */}
            {costInfo?.contextSize && costInfo.contextUsed !== undefined && (
              <div className="space-y-1 border-t border-border/40 pt-4">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-fg/40">Context</span>
                  <span className="tabular-nums text-fg/50">
                    {(costInfo.contextUsed / 1000).toFixed(0)}k / {(costInfo.contextSize / 1000).toFixed(0)}k
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-border/40">
                  <div
                    className={`h-full rounded-full transition-all ${
                      costInfo.contextUsed / costInfo.contextSize > 0.8
                        ? "bg-warning/60"
                        : costInfo.contextUsed / costInfo.contextSize > 0.6
                          ? "bg-accent/50"
                          : "bg-fg/20"
                    }`}
                    style={{ width: `${Math.min(100, (costInfo.contextUsed / costInfo.contextSize) * 100).toFixed(1)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Focus prompt */}
            {scanMeta?.prompt && (
              <div className="rounded-md border border-accent/20 bg-accent/5 p-2.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent/60">
                  Focus
                </p>
                <p className="text-xs leading-relaxed text-fg/70">{scanMeta.prompt}</p>
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* RIGHT PANEL: LLM log stream */}
        <ResizablePanel defaultSize={60} minSize={30}>
          <div className="flex h-full flex-col overflow-y-auto p-4 space-y-2 pb-8">
            <LogFeed
              log={log}
              stopReason={stopReason}
              error={error}
              logEndRef={logEndRef}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* ── Mobile fallback: vertical stack (below md breakpoint) ─────────── */}
      <div className="flex md:hidden flex-col gap-6 pb-16">
        {/* Pipeline steps */}
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-fg/40">
            Pipeline
          </p>
          {STAGES.map((stage, idx) => (
            <PipelineStep
              key={stage.key}
              label={stage.label}
              state={stageState(stage.key)}
              isLast={idx === STAGES.length - 1}
            />
          ))}
        </div>

        {/* LLM log stream */}
        <div className="space-y-2">
          <LogFeed
            log={log}
            stopReason={stopReason}
            error={error}
            logEndRef={logEndRef}
          />
        </div>
      </div>

      {/* New Scan modal */}
      {showNewScanModal && (
        <NewScanModal
          parentScanId={scanId}
          defaultMode={scanMeta?.scanMode ?? "standard"}
          onClose={() => setShowNewScanModal(false)}
          onCreated={handleNewScanCreated}
        />
      )}

      {/* Permission dialog */}
      {pendingPermission && (
        <PermissionDialog
          requestId={pendingPermission.requestId}
          toolName={pendingPermission.toolName}
          input={pendingPermission.input}
          timeoutMs={pendingPermission.timeoutMs}
          scanId={scanId}
          onSettled={() => setPendingPermission(null)}
        />
      )}
    </>
  );
}
