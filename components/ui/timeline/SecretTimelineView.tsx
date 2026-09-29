import { TimelineSidebar } from "./TimelineSidebar";
import type { TimelineResponse } from "@/app/api/findings/[id]/timeline/route";

interface SecretTimelineViewProps {
  /** The finding ID to fetch the timeline for. */
  findingId: string;
}

/**
 * RSC that fetches and renders the secret exposure timeline for a finding.
 *
 * - Fetches `/api/findings/${findingId}/timeline`
 * - Returns null if timeline is pending (202) or finding not found (404)
 * - Delegates rendering to TimelineSidebar (client island)
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export async function SecretTimelineView({ findingId }: SecretTimelineViewProps) {
  let timeline: TimelineResponse | null = null;

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/findings/${findingId}/timeline`, {
      cache: "no-store",
    });

    if (res.ok) {
      timeline = (await res.json()) as TimelineResponse;
    }
  } catch {
    // Network or parse error — render nothing
  }

  if (!timeline) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-fg">Secret Exposure Timeline</h3>
      <TimelineSidebar timeline={timeline} />
    </div>
  );
}
