interface PlanStep {
  title: string;
  status: "pending" | "in_progress" | "done" | "error";
}

interface PlanBlockProps {
  steps: PlanStep[];
}

const STATUS_STYLE: Record<PlanStep["status"], { icon: string; text: string; marker: string; item: string; title: string }> = {
  pending: {
    icon: "○",
    text: "text-fg/30",
    marker: "bg-fg/20",
    item: "",
    title: "text-fg/40",
  },
  in_progress: {
    icon: "◉",
    text: "text-accent",
    marker: "bg-accent/60 animate-pulse",
    item: "font-semibold",
    title: "text-accent/90",
  },
  done: {
    icon: "✓",
    text: "text-success/80",
    marker: "bg-success/50",
    item: "",
    title: "text-success/70",
  },
  error: {
    icon: "✗",
    text: "text-danger/80",
    marker: "bg-danger/50",
    item: "",
    title: "text-danger/80",
  },
};

/**
 * Renders an ordered list of plan steps with status indicators.
 *
 * - Each status has a distinct icon and color
 * - `in_progress` steps are highlighted with a pulsing marker and bold text
 * - Empty steps array shows a "No plan" message
 */
export function PlanBlock({ steps }: PlanBlockProps) {
  if (steps.length === 0) {
    return (
      <div className="my-1 rounded-md border border-border/30 bg-surface/20 px-3 py-2 text-xs text-fg/30 italic">
        No plan
      </div>
    );
  }

  return (
    <div className="my-1 rounded-md border border-border/30 bg-surface/20 px-3 py-2">
      <ul className="space-y-1.5">
        {steps.map((step, i) => {
          const style = STATUS_STYLE[step.status];
          return (
            <li
              key={i}
              className={`flex items-start gap-2 text-xs ${style.text} ${style.item}`}
            >
              {/* Status marker */}
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${style.marker} text-[9px] font-bold text-white`}
              >
                {style.icon}
              </span>

              {/* Step title */}
              <span className={style.title}>{step.title}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
