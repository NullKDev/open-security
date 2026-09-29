"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineResponse } from "@/app/api/findings/[id]/timeline/route";
import type { CommitInfo } from "@/lib/timeline/git-log-parser";

interface TimelineSidebarProps {
  /** The full timeline response with commit history and rotation drafts. */
  timeline: TimelineResponse;
}

/**
 * Interactive sidebar for a secret timeline.
 *
 * - Shows commit dots for introduce and remove commits
 * - Displays suspected deploys counter
 * - Rotation action buttons: open GitHub issue (copy title) and copy Slack draft
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function TimelineSidebar({ timeline }: TimelineSidebarProps) {
  const [githubCopied, setGithubCopied] = useState(false);
  const [slackCopied, setSlackCopied] = useState(false);

  const { commits, suspectedDeploys, rotationDraft } = timeline;

  const introduceCommit = commits.find((c: CommitInfo) => c.action === "introduce");
  const removeCommit = commits.find((c: CommitInfo) => c.action === "remove");

  async function handleGithubCopy() {
    try {
      await navigator.clipboard.writeText(
        `${rotationDraft.githubIssueTitle}\n\n${rotationDraft.githubIssueBody}`,
      );
      setGithubCopied(true);
      setTimeout(() => setGithubCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  async function handleSlackCopy() {
    try {
      await navigator.clipboard.writeText(rotationDraft.slackMessage);
      setSlackCopied(true);
      setTimeout(() => setSlackCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  return (
    <div className="space-y-4">
      {/* Timeline commits */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg/50">
          Exposure Window
        </h4>
        <div className="relative flex flex-col gap-2 pl-4">
          {/* Connecting line */}
          {commits.length > 1 && (
            <span className="absolute left-1.5 top-2 bottom-2 w-px bg-border/60" aria-hidden />
          )}

          {commits.map((commit: CommitInfo) => (
            <div key={commit.hash} className="flex items-start gap-2.5">
              <span
                className={`relative z-10 mt-0.5 h-3 w-3 shrink-0 rounded-full border-2 ${
                  commit.action === "introduce"
                    ? "border-destructive bg-destructive/30"
                    : commit.action === "remove"
                      ? "border-green-500 bg-green-500/30"
                      : "border-border bg-bg"
                }`}
                aria-label={commit.action}
              />
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[11px] text-fg/70">{commit.hash}</span>
                <span className="ml-2 text-[10px] text-fg/40">{commit.date}</span>
                {commit.message && (
                  <p className="text-[11px] text-fg/50 truncate">{commit.message}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Suspected deploys */}
      <div className="rounded-md border border-border bg-surface px-3 py-2">
        <span className="text-xs text-fg/50">Suspected deploys:</span>
        <span className="ml-2 text-sm font-bold text-fg">{suspectedDeploys}</span>
      </div>

      {/* Rotation actions */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg/50">
          Rotation Actions
        </h4>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGithubCopy}
            aria-label="GitHub issue"
          >
            {githubCopied ? "Copied!" : "GitHub issue"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSlackCopy}
            aria-label="Slack draft copy"
          >
            {slackCopied ? "Copied!" : "Slack draft"}
          </Button>
        </div>
      </div>

    </div>
  );
}
