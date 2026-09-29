"use client";

import type { ToolKind } from "@agentclientprotocol/sdk";
import { useState } from "react";

interface ToolLocation {
  path: string;
  line?: number;
}

// ─── Tool metadata ────────────────────────────────────────────────────────────

/** All known ACP ToolKind values plus internal inference categories. */
type KindKey = ToolKind | "glob" | "generic";

interface KindMeta {
  icon: string;
  label: string;
  /** Tailwind text-color class for the icon/label accent. Empty = neutral. */
  accent: string;
  /** ACP schema description (shown as tooltip). */
  description: string;
}

/** Map ACP `kind` → display metadata. Falls back to name inference. */
const KIND_META: Record<KindKey, KindMeta> = {
  read:        { icon: "≡",  label: "Read",   accent: "",                description: "Reading files or data." },
  edit:        { icon: "✎",  label: "Edit",   accent: "text-warning/70", description: "Modifying files or content." },
  delete:      { icon: "⊗",  label: "Delete", accent: "text-danger/60",  description: "Removing files or data." },
  move:        { icon: "→",  label: "Move",   accent: "",                description: "Moving or renaming files." },
  search:      { icon: "⊙",  label: "Search", accent: "",                description: "Searching for information." },
  execute:     { icon: "$",  label: "Run",    accent: "text-success/60", description: "Running commands or code." },
  think:       { icon: "⋯",  label: "Think",  accent: "text-accent/60",  description: "Internal reasoning or planning." },
  fetch:       { icon: "↓",  label: "Fetch",  accent: "",                description: "Retrieving external data." },
  switch_mode: { icon: "⇄",  label: "Mode",   accent: "text-accent/50",  description: "Switching the current session mode." },
  other:       { icon: "⚙",  label: "",       accent: "",                description: "Other tool types." },
  glob:        { icon: "⊛",  label: "List",   accent: "",                description: "Listing files matching a pattern." },
  generic:     { icon: "⚙",  label: "",       accent: "",                description: "" },
};

function classifyFromName(toolName: string): KindKey {
  const t = toolName.toLowerCase();
  if (/\bglob\b|listing|list\b/.test(t)) return "glob";
  if (/\bread\b/.test(t)) return "read";
  if (/\bedit\b|patch|replac/.test(t)) return "edit";
  if (/\bgrep\b|search|find\b|match/.test(t)) return "search";
  if (/\bbash\b|shell|command|execut|run/.test(t)) return "execute";
  if (/\bfetch\b|http/.test(t)) return "fetch";
  if (/\bdelete\b|remov/.test(t)) return "delete";
  return "generic";
}

function getMeta(kind: ToolKind | undefined, toolName: string): KindMeta {
  if (kind && kind in KIND_META) return KIND_META[kind];
  return KIND_META[classifyFromName(toolName)];
}

// ─── Path sanitizer (display only — server already strips workspace prefix) ──

function shortPath(path: string): string {
  const parts = path.replace(/^…\//, "").split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return "…/" + parts.slice(-2).join("/");
}

// ─── XML-tagged content parser (ACP read output format) ───────────────────────
// Agents return file content wrapped in XML tags:
//   <path>/some/file.ts</path><type>file</type><content>1: line\n2: line</content>

interface ParsedFileContent {
  path?: string;
  fileType?: string;
  content?: string;
  raw: string;
}

function parseFileOutput(text: string): ParsedFileContent {
  const path    = text.match(/<path>([\s\S]*?)<\/path>/)?.[1]?.trim();
  const fileType = text.match(/<type>([\s\S]*?)<\/type>/)?.[1]?.trim();
  const content  = text.match(/<content>([\s\S]*?)<\/content>/)?.[1];
  return { path, fileType, content, raw: text };
}

/**
 * Strip leading line numbers (`1: `, `12: `) that agents prepend to content.
 * Returns the cleaned content and the total line count.
 */
function parseContentLines(raw: string): { lines: string[]; total: number } {
  const all = raw.split("\n");
  const lines = all.map((l) => l.replace(/^\s*\d+:\s?/, ""));
  return { lines, total: lines.length };
}

// ─── Output text extractor ────────────────────────────────────────────────────

function extractText(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;
  if (typeof result !== "object") return String(result);
  const obj = result as Record<string, unknown>;
  for (const key of ["content", "output", "text", "result", "data", "stdout"]) {
    if (typeof obj[key] === "string") return obj[key] as string;
  }
  if (Array.isArray(result)) {
    const parts = (result as unknown[])
      .map((item) => {
        if (typeof item === "string") return item;
        const io = item as Record<string, unknown>;
        return typeof io.text === "string" ? io.text : null;
      })
      .filter((s): s is string => s !== null);
    if (parts.length > 0) return parts.join("\n");
  }
  if (Array.isArray(obj.files)) return (obj.files as unknown[]).map(String).join("\n");
  return JSON.stringify(result, null, 2);
}

// ─── Expanded content renderers ───────────────────────────────────────────────

const MAX_LINES = 10;

function ReadOutput({ text }: { text: string }) {
  const parsed = parseFileOutput(text);

  if (parsed.content) {
    const { lines, total } = parseContentLines(parsed.content);
    const visible = lines.slice(0, MAX_LINES);
    const remaining = total - visible.length;
    const [showAll, setShowAll] = useState(false);
    const displayed = showAll ? lines : visible;

    return (
      <div className="space-y-1.5">
        {(parsed.path || parsed.fileType) && (
          <div className="flex items-center gap-2 text-[11px] text-fg/40">
            {parsed.path && <span className="font-mono">{shortPath(parsed.path)}</span>}
            {parsed.fileType && <span className="text-fg/25">· {parsed.fileType}</span>}
          </div>
        )}
        <pre className="max-h-64 overflow-y-auto rounded bg-bg/80 p-2.5 text-[11px] leading-relaxed font-mono text-fg/65 whitespace-pre-wrap break-words">
          {displayed.join("\n")}
          {!showAll && remaining > 0 && (
            <span
              className="block text-fg/30 cursor-pointer hover:text-fg/50 mt-1"
              onClick={() => setShowAll(true)}
            >
              … {remaining} more line{remaining !== 1 ? "s" : ""}
            </span>
          )}
        </pre>
      </div>
    );
  }

  // Fallback: plain text, first MAX_LINES lines
  const lines = text.split("\n");
  const visible = lines.slice(0, MAX_LINES);
  const remaining = lines.length - visible.length;
  const [showAll, setShowAll] = useState(false);
  return (
    <pre className="max-h-64 overflow-y-auto rounded bg-bg/80 p-2.5 text-[11px] leading-relaxed font-mono text-fg/65 whitespace-pre-wrap break-words">
      {(showAll ? lines : visible).join("\n")}
      {!showAll && remaining > 0 && (
        <span className="block text-fg/30 cursor-pointer hover:text-fg/50 mt-1" onClick={() => setShowAll(true)}>
          … {remaining} more line{remaining !== 1 ? "s" : ""}
        </span>
      )}
    </pre>
  );
}

const GLOB_INLINE_MAX = 3;
const GREP_INLINE_MAX = 5;

function GlobOutput({ text }: { text: string }) {
  const files = text.split("\n").filter((l) => l.trim());
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? files : files.slice(0, GLOB_INLINE_MAX);
  const hidden = files.length - GLOB_INLINE_MAX;

  if (files.length === 0) {
    return <span className="text-[11px] text-fg/30 italic">No files matched</span>;
  }

  return (
    <div className="space-y-0.5">
      {visible.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-fg/55">
          <span className="text-fg/25 select-none">·</span>
          <span className="truncate">{f.replace(/^…\//, "")}</span>
        </div>
      ))}
      {!expanded && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 text-[11px] text-fg/30 hover:text-fg/60 transition-colors"
        >
          + {hidden} more file{hidden !== 1 ? "s" : ""}
        </button>
      )}
      {files.length > 0 && (
        <div className="pt-1 text-[10px] text-fg/25">{files.length} total</div>
      )}
    </div>
  );
}

function SearchOutput({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim());
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? lines : lines.slice(0, GREP_INLINE_MAX);
  const hidden = lines.length - GREP_INLINE_MAX;

  if (lines.length === 0) {
    return <span className="text-[11px] text-fg/30 italic">No matches</span>;
  }

  return (
    <div className="space-y-0.5">
      {visible.map((line, i) => {
        const m = line.match(/^([^:]+):(\d+):(.*)/);
        if (m) {
          return (
            <div key={i} className="flex gap-2 text-[11px] font-mono">
              <span className="shrink-0 text-fg/25 select-none w-6 text-right">{m[2]}</span>
              <span className="shrink-0 truncate max-w-[6rem] text-fg/40" title={m[1]}>
                {m[1].split("/").pop()}
              </span>
              <span className="text-fg/65 flex-1 min-w-0 break-all">{m[3]}</span>
            </div>
          );
        }
        return (
          <div key={i} className="text-[11px] font-mono text-fg/55">{line}</div>
        );
      })}
      {!expanded && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 text-[11px] text-fg/30 hover:text-fg/60 transition-colors"
        >
          + {hidden} more result{hidden !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

function BashOutput({ input, text }: { input: unknown; text: string }) {
  const obj = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const cmd = String(obj.command ?? obj.cmd ?? obj.script ?? "");
  const lines = text.split("\n");
  const visible = lines.slice(0, MAX_LINES);
  const remaining = lines.length - visible.length;
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="space-y-1.5">
      {cmd && (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-fg/40">
          <span className="text-success/50 select-none">$</span>
          <span>{cmd}</span>
        </div>
      )}
      <pre className="max-h-64 overflow-y-auto rounded bg-bg/80 p-2.5 text-[11px] leading-relaxed font-mono text-fg/65 whitespace-pre-wrap break-words">
        {(showAll ? lines : visible).join("\n")}
        {!showAll && remaining > 0 && (
          <span className="block text-fg/30 cursor-pointer hover:text-fg/50 mt-1" onClick={() => setShowAll(true)}>
            … {remaining} more line{remaining !== 1 ? "s" : ""}
          </span>
        )}
      </pre>
    </div>
  );
}

function GenericOutput({ text, isError }: { text: string; isError: boolean }) {
  if (isError) {
    return (
      <pre className="rounded bg-danger/5 p-2 text-[11px] font-mono text-danger/70 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
        {text || "Tool call failed"}
      </pre>
    );
  }
  return (
    <pre className="max-h-64 overflow-y-auto rounded bg-bg/80 p-2.5 text-[11px] leading-relaxed font-mono text-fg/65 whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

// ─── Diff renderer ───────────────────────────────────────────────────────────

interface DiffEntry {
  path: string;
  newText: string;
  oldText?: string | null;
}

function DiffOutput({ diffs }: { diffs: DiffEntry[] }) {
  return (
    <div className="space-y-2">
      {diffs.map((diff, i) => (
        <DiffFile key={i} diff={diff} />
      ))}
    </div>
  );
}

function DiffFile({ diff }: { diff: DiffEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasOld = diff.oldText != null && diff.oldText !== "";

  const newLines = diff.newText.split("\n");
  const oldLines = hasOld ? diff.oldText!.split("\n") : [];

  // Build a simple line-level diff: removed (—) then added (+)
  const chunks: Array<{ op: "+" | "-" | "="; text: string }> = [];
  if (!hasOld) {
    // New file — all lines are additions
    newLines.forEach((l) => chunks.push({ op: "+", text: l }));
  } else {
    // Naive full-replace diff: show removed block then added block
    oldLines.forEach((l) => chunks.push({ op: "-", text: l }));
    newLines.forEach((l) => chunks.push({ op: "+", text: l }));
  }

  const visible = expanded ? chunks : chunks.slice(0, 12);
  const hidden = chunks.length - 12;

  return (
    <div className="rounded border border-border/50 overflow-hidden text-[11px] font-mono">
      <div className="flex items-center justify-between bg-surface/60 px-2.5 py-1 border-b border-border/40">
        <span className="text-fg/50 truncate">{shortPath(diff.path)}</span>
        {hasOld ? (
          <span className="text-xs text-fg/30 ml-2 shrink-0">{oldLines.length}→{newLines.length} lines</span>
        ) : (
          <span className="text-xs text-success/50 ml-2 shrink-0">new file</span>
        )}
      </div>
      <div className="overflow-x-auto">
        {visible.map((chunk, idx) => (
          <div
            key={idx}
            className={`px-2.5 py-px whitespace-pre leading-relaxed ${
              chunk.op === "+" ? "bg-success/5 text-success/70" :
              chunk.op === "-" ? "bg-danger/5 text-danger/60 line-through opacity-60" :
              "text-fg/55"
            }`}
          >
            <span className={`select-none mr-2 ${chunk.op === "+" ? "text-success/40" : chunk.op === "-" ? "text-danger/40" : "text-fg/20"}`}>
              {chunk.op === "=" ? " " : chunk.op}
            </span>
            {chunk.text || " "}
          </div>
        ))}
        {!expanded && hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-left px-2.5 py-1 text-fg/30 hover:text-fg/60 transition-colors bg-bg/40"
          >
            … {hidden} more line{hidden !== 1 ? "s" : ""}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ToolCallBlock ────────────────────────────────────────────────────────────

interface ToolCallBlockProps {
  toolName: string;
  toolCallId: string;
  kind?: ToolKind;
  locations?: ToolLocation[];
  input: unknown;
  result?: unknown;
  isError?: boolean;
  diffs?: Array<{ path: string; newText: string; oldText?: string | null }>;
}

/**
 * Renders a tool call as a minimal inline entry.
 *
 * - Collapsed: icon + label + primary path/detail, no colors
 * - Expanded: smart output rendering by kind
 * - Glob: inline file list, expandable only if >3 files
 * - Read: first 10 lines + "… N more lines"
 * - Search: compact grep results
 * - Bash: command + output
 */
export function ToolCallBlock({
  toolName,
  kind,
  locations,
  input,
  result,
  isError = false,
  diffs,
}: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);

  const meta = getMeta(kind, toolName);
  const isPending = result === undefined && !isError;
  const isDone = result !== undefined;

  // Primary detail: prefer ACP locations, fall back to input field
  const primaryPath = (() => {
    if (locations && locations.length > 0) return shortPath(locations[0].path);
    const obj = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const raw = obj.path ?? obj.file_path ?? obj.filePath ?? obj.pattern ?? obj.command ?? obj.query ?? "";
    const s = String(raw);
    if (!s) return "";
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  })();

  const text = extractText(result);
  const effectiveKind: KindKey = kind ?? classifyFromName(toolName);
  const accentCls = meta.accent || "text-fg/60";

  return (
    <div className="flex items-start gap-2 py-0.5 text-[12px] text-fg/60">
      {/* Status dot */}
      <span className="mt-0.5 shrink-0 w-3 flex items-center justify-center">
        {isPending ? (
          <span className="h-1.5 w-1.5 rounded-full bg-fg/20 animate-pulse" />
        ) : isError ? (
          <span className="text-danger/60 text-[10px]">✗</span>
        ) : (
          <span className="text-success/50 text-[10px]">✓</span>
        )}
      </span>

      {/* Icon — colored by kind */}
      <span
        className={`shrink-0 text-[13px] leading-none mt-0.5 ${accentCls}`}
        title={meta.description || undefined}
      >
        {meta.icon}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {meta.label && (
            <span className={`font-medium ${accentCls}`} title={meta.description || undefined}>
              {meta.label}
            </span>
          )}
          <span className="font-mono text-[11px] text-fg/35">{toolName}</span>
          {primaryPath && (
            <span className="font-mono text-[11px] text-fg/40 truncate max-w-xs">{primaryPath}</span>
          )}
          {/* Inline glob (≤3 files shown without expand) */}
          {isDone && (effectiveKind === "glob" || effectiveKind === "search") && !open && (() => {
            const lines = text.split("\n").filter(Boolean);
            if (lines.length <= GLOB_INLINE_MAX && effectiveKind === "glob") {
              return (
                <span className="font-mono text-[11px] text-fg/35">
                  {lines.join("  ")}
                </span>
              );
            }
            return (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-[11px] text-fg/30 hover:text-fg/60 transition-colors"
              >
                {lines.length} result{lines.length !== 1 ? "s" : ""}
              </button>
            );
          })()}
          {/* Expand toggle for non-glob tools */}
          {isDone && effectiveKind !== "glob" && effectiveKind !== "search" && (text || (diffs && diffs.length > 0)) && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-[11px] text-fg/25 hover:text-fg/50 transition-colors ml-auto"
              aria-expanded={open}
            >
              {open ? "▴" : "▾"}
            </button>
          )}
          {/* Expand toggle for search */}
          {isDone && effectiveKind === "search" && text && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-[11px] text-fg/25 hover:text-fg/50 transition-colors ml-auto"
              aria-expanded={open}
            >
              {open ? "▴" : "▾"}
            </button>
          )}
        </div>

        {/* Expanded output */}
        {open && (
          <div className="mt-1.5">
            {isError ? (
              <GenericOutput text={text || "Tool call failed"} isError />
            ) : diffs && diffs.length > 0 ? (
              <DiffOutput diffs={diffs} />
            ) : effectiveKind === "read" ? (
              <ReadOutput text={text} />
            ) : effectiveKind === "glob" ? (
              <GlobOutput text={text} />
            ) : effectiveKind === "search" ? (
              <SearchOutput text={text} />
            ) : effectiveKind === "execute" ? (
              <BashOutput input={input} text={text} />
            ) : (
              <GenericOutput text={text} isError={false} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
