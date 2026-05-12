import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Valid severity levels used across the application. */
type Severity = "critical" | "high" | "medium" | "low" | "info";

const severityClasses: Record<Severity, string> = {
  critical: "bg-danger/15 text-danger border-danger/20",
  high: "bg-accent/15 text-accent border-accent/20",
  medium: "bg-warning/15 text-warning border-warning/20",
  low: "bg-success/15 text-success border-success/20",
  info: "bg-fg/10 text-fg/60 border-fg/10",
};

interface SeverityBadgeProps {
  /** Severity level to display. */
  severity: Severity;
  className?: string;
}

/**
 * SeverityBadge — shadcn Badge extended with semantic severity colors.
 *
 * Uses design-token classes (danger, accent, warning, success) so it
 * adapts automatically to light/dark themes.
 *
 * @example
 * <SeverityBadge severity="critical" />
 */
export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        severityClasses[severity],
        "capitalize font-medium",
        className
      )}
    >
      {severity}
    </Badge>
  );
}
