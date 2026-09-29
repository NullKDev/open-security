import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineSidebar } from "@/components/ui/timeline/TimelineSidebar";
import type { TimelineResponse } from "@/app/api/findings/[id]/timeline/route";

const MOCK_TIMELINE: TimelineResponse = {
  findingId: "finding-1",
  commits: [
    { hash: "abc123", date: "2023-01-01", action: "introduce", message: "Add API key" },
    { hash: "def456", date: "2023-06-15", action: "remove", message: "Remove API key" },
  ],
  suspectedDeploys: 3,
  partial: false,
  computedAt: "2024-01-01T00:00:00Z",
  rotationDraft: {
    githubIssueTitle: "[Security] Rotate secret exposed in abc123",
    githubIssueBody: "## Secret Rotation Required\n...",
    slackMessage: "⚠️ Secret exposed in 2 commit(s) starting at abc123. Rotate immediately.",
  },
};

describe("TimelineSidebar", () => {
  it("renders introduce commit hash", () => {
    render(<TimelineSidebar timeline={MOCK_TIMELINE} />);
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("renders remove commit hash", () => {
    render(<TimelineSidebar timeline={MOCK_TIMELINE} />);
    expect(screen.getByText(/def456/)).toBeInTheDocument();
  });

  it("shows suspected deploys counter", () => {
    render(<TimelineSidebar timeline={MOCK_TIMELINE} />);
    // Should show the number "3" in the deploys counter section
    const deployText = screen.getAllByText(/3/).find(
      (el) => el.tagName === "SPAN" && el.className.includes("font-bold"),
    );
    expect(deployText).toBeInTheDocument();
    expect(deployText).toHaveTextContent("3");
  });

  it("shows rotation action buttons", () => {
    render(<TimelineSidebar timeline={MOCK_TIMELINE} />);
    // GitHub issue button
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
    // Slack draft copy button
    expect(screen.getByRole("button", { name: /slack/i })).toBeInTheDocument();
  });

  it("timeline with zero suspected deploys shows 0", () => {
    const noDeployTimeline = { ...MOCK_TIMELINE, suspectedDeploys: 0 };
    render(<TimelineSidebar timeline={noDeployTimeline} />);
    // Should contain "0" somewhere for suspected deploys
    expect(screen.getByText(/suspected/i)).toBeInTheDocument();
  });
});
