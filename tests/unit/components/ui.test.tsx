import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

/* ================================================================
 *  BUTTON
 * ================================================================ */
describe("Button", () => {
  it("renders its children as text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    let clicked = false;
    const user = userEvent.setup();
    render(<Button onClick={() => { clicked = true; }}>Fire</Button>);
    await user.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });

  it("does not call onClick when disabled", async () => {
    let clicked = false;
    const user = userEvent.setup();
    render(<Button disabled onClick={() => { clicked = true; }}>Noop</Button>);
    await user.click(screen.getByRole("button"));
    expect(clicked).toBe(false);
  });

  it("renders disabled attribute on the button element", () => {
    render(<Button disabled>Greyed</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("renders as disabled and shows spinner when loading", () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("shows text alongside spinner when loading", () => {
    render(<Button loading>Please wait</Button>);
    expect(screen.getByText("Please wait")).toBeInTheDocument();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("renders primary variant (default) as a button", () => {
    render(<Button variant="primary">Primary</Button>);
    expect(screen.getByRole("button", { name: "Primary" })).toBeInTheDocument();
  });

  it("renders secondary variant as a button", () => {
    render(<Button variant="secondary">Outline</Button>);
    expect(screen.getByRole("button", { name: "Outline" })).toBeInTheDocument();
  });

  it("renders ghost variant as a button", () => {
    render(<Button variant="ghost">Quiet</Button>);
    expect(screen.getByRole("button", { name: "Quiet" })).toBeInTheDocument();
  });

  it("renders danger variant as a button", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renders left icon before text", () => {
    render(
      <Button iconLeft={<span data-testid="left-icon">←</span>}>Back</Button>
    );
    const btn = screen.getByRole("button", { name: "←Back" });
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId("left-icon")).toBeInTheDocument();
    // left icon element comes before text in DOM
    const html = btn.innerHTML;
    expect(html.indexOf("left-icon")).toBeLessThan(html.indexOf("Back"));
  });

  it("renders right icon after text", () => {
    render(
      <Button iconRight={<span data-testid="right-icon">→</span>}>Next</Button>
    );
    const btn = screen.getByRole("button", { name: "Next→" });
    expect(btn).toBeInTheDocument();
    const html = btn.innerHTML;
    expect(html.indexOf("Next")).toBeLessThan(html.indexOf("right-icon"));
  });
});

/* ================================================================
 *  CARD
 * ================================================================ */
describe("Card", () => {
  it("renders children inside the card", () => {
    render(
      <Card>
        <p>Card content</p>
      </Card>
    );
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("renders Card.Header with a title", () => {
    render(
      <Card>
        <Card.Header title="My Title" />
      </Card>
    );
    expect(screen.getByText("My Title")).toBeInTheDocument();
  });

  it("renders Card.Header with subtitle when provided", () => {
    render(
      <Card>
        <Card.Header title="Title" subtitle="A supporting line" />
      </Card>
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("A supporting line")).toBeInTheDocument();
  });

  it("renders Card.Body content", () => {
    render(
      <Card>
        <Card.Body>Body text here</Card.Body>
      </Card>
    );
    expect(screen.getByText("Body text here")).toBeInTheDocument();
  });

  it("renders Card.Footer content", () => {
    render(
      <Card>
        <Card.Footer>Footer actions</Card.Footer>
      </Card>
    );
    expect(screen.getByText("Footer actions")).toBeInTheDocument();
  });

  it("composes Header, Body, and Footer together", () => {
    render(
      <Card>
        <Card.Header title="Scan Results" />
        <Card.Body>42 findings</Card.Body>
        <Card.Footer>Export</Card.Footer>
      </Card>
    );
    expect(screen.getByText("Scan Results")).toBeInTheDocument();
    expect(screen.getByText("42 findings")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
  });
});

/* ================================================================
 *  TABS
 * ================================================================ */
describe("Tabs", () => {
  const tabItems = [
    { id: "overview", label: "Overview", content: <p>Overview panel</p> },
    { id: "findings", label: "Findings", content: <p>Findings panel</p> },
    { id: "timeline", label: "Timeline", content: <p>Timeline panel</p> },
  ];

  it("renders all tab buttons", () => {
    render(<Tabs items={tabItems} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Timeline" })).toBeInTheDocument();
  });

  it("shows first tab content by default", () => {
    render(<Tabs items={tabItems} />);
    expect(screen.getByText("Overview panel")).toBeInTheDocument();
  });

  it("does not show inactive tab content", () => {
    render(<Tabs items={tabItems} />);
    // Inactive panel is present but hidden
    const findingsPanel = document.getElementById("panel-findings");
    expect(findingsPanel).toHaveAttribute("hidden");
  });

  it("switches content on tab click", async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabItems} />);
    await user.click(screen.getByRole("tab", { name: "Findings" }));
    expect(screen.getByText("Findings panel")).toBeInTheDocument();
    // Overview panel is now hidden
    const overviewPanel = document.getElementById("panel-overview");
    expect(overviewPanel).toHaveAttribute("hidden");
  });

  it("marks active tab with aria-selected", async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabItems} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(screen.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false");
  });

  it("supports keyboard arrow navigation", async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabItems} />);

    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();

    // Right arrow → Findings
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Findings panel")).toBeInTheDocument();

    // Right arrow → Timeline
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Timeline panel")).toBeInTheDocument();

    // Left arrow → Findings
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Findings panel")).toBeInTheDocument();
  });

  it("calls onTabChange callback when tab is clicked", async () => {
    const user = userEvent.setup();
    let lastTab = "";
    render(<Tabs items={tabItems} onTabChange={(id) => { lastTab = id; }} />);
    await user.click(screen.getByRole("tab", { name: "Findings" }));
    expect(lastTab).toBe("findings");
  });

  it("renders tablist with proper ARIA role", () => {
    render(<Tabs items={tabItems} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});

/* ================================================================
 *  BADGE
 * ================================================================ */
describe("Badge", () => {
  it("renders text content", () => {
    render(<Badge>High</Badge>);
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("renders critical severity with visible text", () => {
    render(<Badge severity="critical">CRITICAL</Badge>);
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
  });

  it("renders high severity with visible text", () => {
    render(<Badge severity="high">HIGH</Badge>);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  it("renders medium severity with visible text", () => {
    render(<Badge severity="medium">MEDIUM</Badge>);
    expect(screen.getByText("MEDIUM")).toBeInTheDocument();
  });

  it("renders low severity with visible text", () => {
    render(<Badge severity="low">LOW</Badge>);
    expect(screen.getByText("LOW")).toBeInTheDocument();
  });

  it("renders info severity with visible text", () => {
    render(<Badge severity="info">INFO</Badge>);
    expect(screen.getByText("INFO")).toBeInTheDocument();
  });

  it("renders scan status: pending", () => {
    render(<Badge status="pending">Pending</Badge>);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders scan status: running", () => {
    render(<Badge status="running">Running</Badge>);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("renders scan status: done", () => {
    render(<Badge status="done">Done</Badge>);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders scan status: failed", () => {
    render(<Badge status="failed">Failed</Badge>);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders scan status: cancelled", () => {
    render(<Badge status="cancelled">Cancelled</Badge>);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});
