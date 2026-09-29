import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Verdict = "exposed" | "not-exposed" | "indeterminate";

interface VerdictBadgeProps {
  /** The hunt verdict to display. */
  verdict: Verdict;
}

const VERDICT_STYLES: Record<Verdict, string> = {
  exposed: "bg-destructive/15 text-destructive border-destructive/30",
  "not-exposed": "bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-400",
  indeterminate: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-400",
};

/**
 * Badge showing the result of a hunt scan.
 *
 * - `exposed` → red styling
 * - `not-exposed` → green styling
 * - `indeterminate` → yellow styling
 */
export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  return (
    <Badge
      data-verdict={verdict}
      className={cn("border", VERDICT_STYLES[verdict])}
    >
      {verdict}
    </Badge>
  );
}
