"use client";

import { useState } from "react";
import type { Playbook } from "@/lib/playbooks/schema";
import { PlaybookParamForm } from "./PlaybookParamForm";
import { cn } from "@/lib/utils";

interface PlaybookSelectorProps {
  /** Available playbooks to display. */
  playbooks: Playbook[];
  /** Called with `playbook:id@version` strategy string when selection is confirmed. */
  onSelect: (strategy: string) => void;
}

/**
 * Grid of playbook cards. Selecting a playbook with no required parameters
 * calls `onSelect` immediately. Selecting one with required parameters shows
 * `PlaybookParamForm` first.
 *
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function PlaybookSelector({ playbooks, onSelect }: PlaybookSelectorProps) {
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);

  function hasRequiredParams(playbook: Playbook): boolean {
    if (!playbook.parameters) return false;
    return Object.values(playbook.parameters).some(
      (param) => typeof param === "object" && param !== null && (param as Record<string, unknown>).required === true,
    );
  }

  function handleCardClick(playbook: Playbook) {
    if (hasRequiredParams(playbook)) {
      setSelectedPlaybook(playbook);
    } else {
      onSelect(`playbook:${playbook.id}@${playbook.version}`);
    }
  }

  function handleParamConfirm(_params: Record<string, string>) {
    if (!selectedPlaybook) return;
    onSelect(`playbook:${selectedPlaybook.id}@${selectedPlaybook.version}`);
    setSelectedPlaybook(null);
  }

  if (selectedPlaybook) {
    return (
      <PlaybookParamForm playbook={selectedPlaybook} onConfirm={handleParamConfirm} />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {playbooks.map((playbook) => (
        <button
          key={playbook.id}
          type="button"
          onClick={() => handleCardClick(playbook)}
          className={cn(
            "text-left rounded-lg border border-border bg-surface p-4 space-y-1.5 transition-colors duration-[120ms] hover:border-accent/60 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-fg text-sm">{playbook.name}</span>
            <span className="text-[10px] font-mono text-fg/40">v{playbook.version}</span>
          </div>
          {playbook.description && (
            <p className="text-xs text-fg/60 leading-relaxed">{playbook.description}</p>
          )}
          {playbook.source === "user" && (
            <span className="inline-block rounded-sm border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-400">
              user
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
