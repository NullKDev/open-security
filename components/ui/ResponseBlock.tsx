"use client";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

interface ResponseBlockProps {
  text: string;
  /** True while the agent is still streaming this message. */
  active?: boolean;
}

/**
 * Renders the agent's response as clean prose markdown — no border, no box.
 * Reads like flowing text from the agent directly to the user.
 * While `active`, shows a blinking cursor at the end.
 */
export function ResponseBlock({ text, active = false }: ResponseBlockProps) {
  const trimmed = text.trimEnd();

  return (
    <div className="px-1 py-0.5">
      <div
        className={[
          "prose prose-sm max-w-none",
          "text-fg/85",
          // Headings
          "[&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-fg [&_h1]:mt-4 [&_h1]:mb-1",
          "[&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-fg [&_h2]:mt-3 [&_h2]:mb-1",
          "[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-fg/80 [&_h3]:mt-2 [&_h3]:mb-0.5",
          // Paragraphs
          "[&_p]:my-1.5 [&_p]:leading-relaxed [&_p]:text-[13px]",
          // Inline code
          "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-surface [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5",
          "[&_:not(pre)>code]:text-[11px] [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-fg/80",
          // Code blocks
          "[&_pre]:rounded-md [&_pre]:bg-bg/90 [&_pre]:px-4 [&_pre]:py-3 [&_pre]:my-2 [&_pre]:overflow-x-auto",
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[11px] [&_pre_code]:leading-relaxed",
          // Lists
          "[&_ul]:my-1.5 [&_ul]:pl-5 [&_ul]:space-y-0.5",
          "[&_ol]:my-1.5 [&_ol]:pl-5 [&_ol]:space-y-0.5",
          "[&_li]:text-[13px] [&_li]:leading-relaxed",
          // Blockquote
          "[&_blockquote]:border-l-2 [&_blockquote]:border-accent/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-fg/55",
          // Strong / em
          "[&_strong]:font-semibold [&_strong]:text-fg",
          // HR
          "[&_hr]:border-border/30 [&_hr]:my-3",
          // Links
          "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
          // Tables
          "[&_table]:text-[12px] [&_th]:text-left [&_th]:font-semibold [&_td]:py-0.5",
        ].join(" ")}
      >
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{trimmed}</ReactMarkdown>
      </div>
      {active && (
        <span
          className="inline-block h-3.5 w-0.5 bg-fg/50 align-middle ml-0.5 animate-pulse"
          aria-hidden
        />
      )}
    </div>
  );
}
