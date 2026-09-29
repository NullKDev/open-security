import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookSelector } from "@/components/ui/playbook/PlaybookSelector";
import type { Playbook } from "@/lib/playbooks/schema";

/**
 * Tests for PlaybookSelector integration in scan launch UI.
 *
 * The new scan form is an RSC that requires DB access for playbook listing.
 * We test the PlaybookSelector component directly (the part that integrates
 * into the form) and verify the strategy field is set correctly.
 */

const MOCK_PLAYBOOKS: Playbook[] = [
  {
    id: "find-ssrf",
    name: "Find SSRF",
    version: "1.0.0",
    description: "Scans for SSRF vulnerabilities",
    promptTemplate: "Find SSRF",
    source: "builtin",
    builtIn: true,
    trusted: true,
  },
];

describe("PlaybookSelector in scan launch UI", () => {
  it("PlaybookSelector renders when playbook mode selected", () => {
    const onSelect = vi.fn();
    render(<PlaybookSelector playbooks={MOCK_PLAYBOOKS} onSelect={onSelect} />);
    expect(screen.getByText("Find SSRF")).toBeInTheDocument();
  });

  it("on playbook selection, strategy field is updated with playbook:id@version format", async () => {
    const user = userEvent.setup();
    let capturedStrategy = "";
    const onSelect = (strategy: string) => {
      capturedStrategy = strategy;
    };

    render(<PlaybookSelector playbooks={MOCK_PLAYBOOKS} onSelect={onSelect} />);

    await user.click(screen.getByText("Find SSRF"));

    await waitFor(() => {
      expect(capturedStrategy).toBe("playbook:find-ssrf@1.0.0");
    });
  });

  it("strategy string follows playbook:name@version format", async () => {
    const user = userEvent.setup();
    const strategies: string[] = [];

    const multiPlaybooks: Playbook[] = [
      ...MOCK_PLAYBOOKS,
      {
        id: "find-sqli",
        name: "Find SQLi",
        version: "2.5.0",
        description: "SQL injection scanner",
        promptTemplate: "Find SQL injection",
        source: "builtin",
        builtIn: true,
        trusted: true,
      },
    ];

    render(
      <PlaybookSelector playbooks={multiPlaybooks} onSelect={(s) => strategies.push(s)} />,
    );

    await user.click(screen.getByText("Find SQLi"));

    await waitFor(() => {
      expect(strategies[0]).toBe("playbook:find-sqli@2.5.0");
    });
  });
});
