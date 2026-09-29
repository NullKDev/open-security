import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation before importing Sidebar
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Mock child components that have complex dependencies
vi.mock("@/components/project/NewProjectForm", () => ({
  NewProjectForm: ({ onSubmit }: { onSubmit: () => void }) => (
    <button onClick={onSubmit}>New Project</button>
  ),
}));

vi.mock("@/components/project/ScanConfig", () => ({
  ScanConfig: () => <div>ScanConfig</div>,
}));

vi.mock("@/components/theme/ThemeToggle", () => ({
  ThemeToggle: () => <div>ThemeToggle</div>,
}));

describe("Sidebar nav — Hunt link", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_OBT_CONSOLE_V2;
  });

  it("shows Hunt link when NEXT_PUBLIC_OBT_CONSOLE_V2 is '1'", async () => {
    process.env.NEXT_PUBLIC_OBT_CONSOLE_V2 = "1";
    // Dynamically re-import after env var set (module eval happens at import time)
    vi.resetModules();
    const { Sidebar } = await import("@/components/Sidebar");
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /hunt/i })).toBeInTheDocument();
  });

  it("hides Hunt link when NEXT_PUBLIC_OBT_CONSOLE_V2 is not set", async () => {
    delete process.env.NEXT_PUBLIC_OBT_CONSOLE_V2;
    vi.resetModules();
    const { Sidebar } = await import("@/components/Sidebar");
    render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /hunt/i })).not.toBeInTheDocument();
  });
});

describe("Sidebar nav — Posture link", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("always shows Posture link", async () => {
    vi.resetModules();
    const { Sidebar } = await import("@/components/Sidebar");
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /posture/i })).toBeInTheDocument();
  });

  it("Posture link points to /posture", async () => {
    vi.resetModules();
    const { Sidebar } = await import("@/components/Sidebar");
    render(<Sidebar />);
    const link = screen.getByRole("link", { name: /posture/i });
    expect(link).toHaveAttribute("href", "/posture");
  });
});
