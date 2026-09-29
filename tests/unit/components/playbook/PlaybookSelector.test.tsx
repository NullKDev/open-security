import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookSelector } from "@/components/ui/playbook/PlaybookSelector";
import type { Playbook } from "@/lib/playbooks/schema";

const PLAYBOOKS: Playbook[] = [
  {
    id: "find-ssrf",
    name: "Find SSRF",
    version: "1.0.0",
    description: "Scans for SSRF vulnerabilities",
    promptTemplate: "Find SSRF in {{target}}",
    source: "builtin",
    builtIn: true,
    trusted: true,
  },
  {
    id: "find-sqli",
    name: "Find SQLi",
    version: "2.0.0",
    description: "Scans for SQL injection",
    promptTemplate: "Find SQLi in {{target}}",
    parameters: { target: { type: "string", required: true } },
    source: "builtin",
    builtIn: true,
    trusted: true,
  },
];

describe("PlaybookSelector", () => {
  it("renders grid of playbook cards", () => {
    render(<PlaybookSelector playbooks={PLAYBOOKS} onSelect={vi.fn()} />);
    expect(screen.getByText("Find SSRF")).toBeInTheDocument();
    expect(screen.getByText("Find SQLi")).toBeInTheDocument();
  });

  it("shows playbook descriptions", () => {
    render(<PlaybookSelector playbooks={PLAYBOOKS} onSelect={vi.fn()} />);
    expect(screen.getByText("Scans for SSRF vulnerabilities")).toBeInTheDocument();
    expect(screen.getByText("Scans for SQL injection")).toBeInTheDocument();
  });

  it("selecting a playbook without required params calls onSelect with strategy", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<PlaybookSelector playbooks={PLAYBOOKS} onSelect={onSelect} />);

    // Click on Find SSRF (no required params)
    await user.click(screen.getByText("Find SSRF"));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("playbook:find-ssrf@1.0.0");
    });
  });

  it("selecting a playbook with required params shows param form first", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<PlaybookSelector playbooks={PLAYBOOKS} onSelect={onSelect} />);

    // Click on Find SQLi (has required param)
    await user.click(screen.getByText("Find SQLi"));

    // Param form should be visible
    expect(screen.getByText(/parameters/i)).toBeInTheDocument();
    // onSelect not called yet
    expect(onSelect).not.toHaveBeenCalled();
  });
});
