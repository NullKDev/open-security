"use client";

import { useState } from "react";

interface TimelineEvent {
  id: string;
  type: string;
  timestamp: string;
}

interface TimelineScrubberProps {
  /** List of timeline events to display as scrubber dots. */
  events: TimelineEvent[];
  /** Called with the selected event ID when a dot is clicked. */
  onSelect: (id: string) => void;
}

/**
 * Horizontal scrubber showing event dots for a scan timeline.
 *
 * - Each event is represented as a clickable dot
 * - Clicking a dot selects it and calls `onSelect(id)`
 * - Selected dot is visually highlighted and has `aria-pressed="true"`
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function TimelineScrubber({ events, onSelect }: TimelineScrubberProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleSelect(id: string) {
    setSelectedId(id);
    onSelect(id);
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-2 overflow-x-auto">
      {events.map((evt) => {
        const isSelected = evt.id === selectedId;
        return (
          <button
            key={evt.id}
            type="button"
            aria-label={`Event ${evt.id} — ${evt.type}`}
            aria-pressed={isSelected}
            title={`${evt.type} at ${evt.timestamp}`}
            onClick={() => handleSelect(evt.id)}
            className={`h-3 w-3 shrink-0 rounded-full border transition-colors duration-[120ms] ${
              isSelected
                ? "border-accent bg-accent"
                : "border-fg/30 bg-fg/10 hover:border-accent/60 hover:bg-accent/20"
            }`}
          />
        );
      })}
    </div>
  );
}
