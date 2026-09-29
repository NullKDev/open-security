import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookTrustDialog } from "@/components/ui/playbook/PlaybookTrustDialog";
import type { Playbook } from "@/lib/playbooks/schema";

const USER_PLAYBOOK: Playbook = {
  id: "my-custom-scan",
  name: "My Custom Scan",
  version: "1.0.0",
  description: "A user-created playbook",
  promptTemplate: "Scan {{target}}",
  source: "user",
  builtIn: false,
  trusted: false,
};

const originalFetch = globalThis.fetch;

describe("PlaybookTrustDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders trust prompt for non-builtin playbook", () => {
    render(
      <PlaybookTrustDialog
        playbook={USER_PLAYBOOK}
        onTrusted={vi.fn()}
        onDenied={vi.fn()}
      />,
    );
    expect(screen.getByText(/My Custom Scan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /trust/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  it("Trust button calls POST to update trusted:true and calls onTrusted", async () => {
    const user = userEvent.setup();
    const onTrusted = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <PlaybookTrustDialog
        playbook={USER_PLAYBOOK}
        onTrusted={onTrusted}
        onDenied={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /trust/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/playbooks",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining('"trusted":true'),
        }),
      );
    });
    await waitFor(() => expect(onTrusted).toHaveBeenCalledTimes(1));
  });

  it("Deny button calls onDenied without making a POST", async () => {
    const user = userEvent.setup();
    const onDenied = vi.fn();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <PlaybookTrustDialog
        playbook={USER_PLAYBOOK}
        onTrusted={vi.fn()}
        onDenied={onDenied}
      />,
    );

    await user.click(screen.getByRole("button", { name: /deny/i }));

    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
