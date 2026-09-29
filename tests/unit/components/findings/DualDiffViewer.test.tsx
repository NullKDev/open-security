import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DualDiffViewer } from "@/components/findings/DualDiffViewer";

const SAMPLE_FIX_DIFF = `--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,8 @@
 function verifyToken(token: string) {
-  return decode(token);
+  const payload = decode(token);
+  if (!payload) throw new Error('invalid token');
+  return payload;
 }`;

const SAMPLE_REG_DIFF = `--- a/tests/auth.test.ts
+++ b/tests/auth.test.ts
@@ -1,4 +1,10 @@
+it('rejects invalid token', () => {
+  expect(() => verifyToken('bad')).toThrow();
+});`;

describe("DualDiffViewer", () => {
  it("renders two panel headings", () => {
    render(
      <DualDiffViewer
        fixDiff={SAMPLE_FIX_DIFF}
        regressionTestDiff={SAMPLE_REG_DIFF}
        regressionTestPath="tests/auth.test.ts"
      />
    );
    expect(screen.getAllByText(/fix diff/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/regression test/i).length).toBeGreaterThan(0);
  });

  it("highlights + lines with green color class", () => {
    render(
      <DualDiffViewer
        fixDiff={SAMPLE_FIX_DIFF}
        regressionTestDiff={SAMPLE_REG_DIFF}
        regressionTestPath="tests/auth.test.ts"
      />
    );
    const addedLines = document.querySelectorAll(".diff-added");
    expect(addedLines.length).toBeGreaterThan(0);
  });

  it("highlights - lines with red color class", () => {
    render(
      <DualDiffViewer
        fixDiff={SAMPLE_FIX_DIFF}
        regressionTestDiff={SAMPLE_REG_DIFF}
        regressionTestPath="tests/auth.test.ts"
      />
    );
    const removedLines = document.querySelectorAll(".diff-removed");
    expect(removedLines.length).toBeGreaterThan(0);
  });

  it("displays the regression test path", () => {
    render(
      <DualDiffViewer
        fixDiff={SAMPLE_FIX_DIFF}
        regressionTestDiff={SAMPLE_REG_DIFF}
        regressionTestPath="tests/auth.test.ts"
      />
    );
    // Path appears at least once in the dedicated path label
    expect(screen.getAllByText(/tests\/auth\.test\.ts/).length).toBeGreaterThan(0);
  });

  it("collapses gracefully when fixDiff is empty", () => {
    render(
      <DualDiffViewer
        fixDiff=""
        regressionTestDiff={SAMPLE_REG_DIFF}
        regressionTestPath="tests/auth.test.ts"
      />
    );
    expect(screen.getByText(/no fix diff/i)).toBeInTheDocument();
  });

  it("collapses gracefully when regressionTestDiff is empty", () => {
    render(
      <DualDiffViewer
        fixDiff={SAMPLE_FIX_DIFF}
        regressionTestDiff=""
        regressionTestPath="tests/auth.test.ts"
      />
    );
    expect(screen.getByText(/no regression test diff/i)).toBeInTheDocument();
  });

  it("accepts an optional className prop", () => {
    const { container } = render(
      <DualDiffViewer
        fixDiff={SAMPLE_FIX_DIFF}
        regressionTestDiff={SAMPLE_REG_DIFF}
        regressionTestPath="tests/auth.test.ts"
        className="my-custom-class"
      />
    );
    expect(container.firstChild).toHaveClass("my-custom-class");
  });
});
