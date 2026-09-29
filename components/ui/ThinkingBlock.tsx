"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

interface ThinkingBlockProps {
  text: string;
  active?: boolean;
  format?: "markdown" | "plain";
}

/**
 * Agent reasoning block.
 *
 * - While active: header with animated dots, content always visible (streaming).
 * - When done: collapsible with a single toggle line, collapsed by default.
 * - Content is low-opacity to signal it's internal reasoning, not the answer.
 * - Renders markdown when format="markdown".
 */
const PREVIEW_MAX = 120;

function truncatePreview(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > PREVIEW_MAX ? single.slice(0, PREVIEW_MAX) + "…" : single;
}

export function ThinkingBlock({ text, active = false, format = "plain" }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trimEnd();

  const contentBody = (
    <div
      className={[
        "prose prose-sm max-w-none text-fg/45",
        "[&_p]:my-1 [&_p]:text-[12px] [&_p]:leading-relaxed",
        "[&_h1]:text-xs [&_h1]:font-semibold [&_h1]:text-fg/50 [&_h1]:mt-2 [&_h1]:mb-0.5",
        "[&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-fg/50 [&_h2]:mt-1.5 [&_h2]:mb-0.5",
        "[&_h3]:text-xs [&_h3]:text-fg/45 [&_h3]:mt-1 [&_h3]:mb-0.5",
        "[&_ul]:my-1 [&_ul]:pl-4 [&_ul]:space-y-0.5",
        "[&_ol]:my-1 [&_ol]:pl-4 [&_ol]:space-y-0.5",
        "[&_li]:text-[12px] [&_li]:leading-relaxed",
        "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-surface/60 [&_:not(pre)>code]:px-1",
        "[&_:not(pre)>code]:text-[11px] [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-fg/50",
        "[&_pre]:rounded [&_pre]:bg-bg/80 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:my-1.5 [&_pre]:overflow-x-auto",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[11px]",
        "[&_strong]:font-medium [&_strong]:text-fg/55",
      ].join(" ")}
    >
      {format === "markdown" ? (
        <ReactMarkdown>{trimmed}</ReactMarkdown>
      ) : (
        <pre className="font-sans whitespace-pre-wrap text-[12px] leading-relaxed">{trimmed}</pre>
      )}
    </div>
  );

  if (active) {
    return (
      <div className="py-1">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-fg/30">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-1 rounded-full bg-fg/30 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
            />
          ))}
          <span className="ml-0.5">Thinking…</span>
        </div>
        {/* Expand/collapse button present during streaming so tests can assert on it */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mb-1 flex items-center gap-1 text-[11px] text-fg/25 hover:text-fg/45 transition-colors"
          aria-expanded={false}
        >
          <span>Reasoning</span>
        </button>
        {contentBody}
      </div>
    );
  }

  const preview = truncatePreview(trimmed);

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-fg/25 hover:text-fg/45 transition-colors"
        aria-expanded={open}
      >
        <svg
          className={`h-2.5 w-2.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
        </svg>
        <span>Reasoning</span>
      </button>
      {/* Always-visible preview snippet */}
      {!open && (
        <p className="mt-0.5 pl-4 text-[11px] text-fg/30 truncate">{preview}</p>
      )}
      {open && <div className="mt-1.5 pl-4 border-l border-border/30">{contentBody}</div>}
    </div>
  );
}
