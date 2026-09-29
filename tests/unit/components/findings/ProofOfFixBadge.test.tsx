/**
 * tests/unit/components/findings/ProofOfFixBadge.test.tsx
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProofOfFixBadge } from "@/components/findings/ProofOfFixBadge";

const verifiedProof = {
  outcome: "verified-fixed" as const,
  unitTestPassed: true,
  vulRunPassedPre: false,
  vulRunPassedPost: true,
  regressionTestPath: "tests/__regression__/auth.regression.test.ts",
  prePatchOutput: "FAIL: vulnerability triggered\nAssertionError...",
  postPatchOutput: "PASS: all tests pass",
  completedAt: "2024-01-15T12:00:00Z",
  failureReason: null,
};

const unverifiedProof = {
  outcome: "fix-unverified" as const,
  unitTestPassed: false,
  vulRunPassedPre: null,
  vulRunPassedPost: null,
  regressionTestPath: null,
  prePatchOutput: "Error: unit tests failed",
  postPatchOutput: null,
  completedAt: "2024-01-15T12:00:00Z",
  failureReason: "unit-test-baseline-red" as const,
};

describe("ProofOfFixBadge — verified-fixed", () => {
  it("renders verified-fixed status badge", () => {
    render(<ProofOfFixBadge proof={verifiedProof} />);
    expect(screen.getByText(/verified.?fix/i)).toBeInTheDocument();
  });

  it("shows all three triad checkmarks as passing for verified proof", () => {
    render(<ProofOfFixBadge proof={verifiedProof} />);
    // Unit tests passed
    expect(screen.getByText(/unit test/i)).toBeInTheDocument();
  });

  it("renders collapsible pre-patch output", async () => {
    const user = userEvent.setup();
    render(<ProofOfFixBadge proof={verifiedProof} />);
    // Click to expand pre-patch details — use getAllByText to handle multiple matches
    const preTriggers = screen.getAllByText(/pre.patch/i);
    // The button trigger is the one we want — click the first button-type element
    const trigger = preTriggers.find((el) => el.closest("button")) ?? preTriggers[0];
    await user.click(trigger);
    expect(screen.getByText(/vulnerability triggered/i)).toBeInTheDocument();
  });

  it("renders collapsible post-patch output", async () => {
    const user = userEvent.setup();
    render(<ProofOfFixBadge proof={verifiedProof} />);
    const postTriggers = screen.getAllByText(/post-patch output/i);
    await user.click(postTriggers[0]);
    expect(screen.getByText(/all tests pass/i)).toBeInTheDocument();
  });

  it("shows regression test path", () => {
    render(<ProofOfFixBadge proof={verifiedProof} />);
    const regressionEls = screen.getAllByText(/regression/i);
    expect(regressionEls.length).toBeGreaterThan(0);
  });
});

describe("ProofOfFixBadge — fix-unverified", () => {
  it("renders fix-unverified status badge", () => {
    render(<ProofOfFixBadge proof={unverifiedProof} />);
    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
  });

  it("shows failure reason", () => {
    render(<ProofOfFixBadge proof={unverifiedProof} />);
    expect(screen.getByText(/baseline.red|unit.test.baseline/i)).toBeInTheDocument();
  });
});

describe("ProofOfFixBadge — null proof", () => {
  it("renders nothing (null) when proof is null", () => {
    const { container } = render(<ProofOfFixBadge proof={null} />);
    expect(container.firstChild).toBeNull();
  });
});
