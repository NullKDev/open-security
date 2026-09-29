import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

function setupDocumentTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.removeItem("obt-theme");
  document.cookie.split(";").forEach((c) => {
    document.cookie = c
      .replace(/^ +/, "")
      .replace(/=.*/, "=;expires=" + new Date(0).toUTCString());
  });
}

function setupSystemPreference(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && prefersDark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  setupDocumentTheme("light");
});

describe("ThemeToggle", () => {
  it("renders with moon icon when theme is light", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });
    expect(button).toBeInTheDocument();
    // When theme is light → moon icon visible (click to go dark), sun icon hidden
    expect(screen.getByTestId("icon-moon")).not.toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("icon-sun")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders with sun icon when theme is dark", () => {
    setupDocumentTheme("dark");
    render(<ThemeToggle />);
    // When theme is dark → sun icon visible (click to go light), moon icon hidden
    expect(screen.getByTestId("icon-sun")).not.toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("icon-moon")).toHaveAttribute("aria-hidden", "true");
  });

  it("toggles from light to dark on click", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });

    await user.click(button);

    // After toggle: dark theme → sun visible, moon hidden
    expect(screen.getByTestId("icon-sun")).not.toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("icon-moon")).toHaveAttribute("aria-hidden", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggles from dark to light on click", async () => {
    setupDocumentTheme("dark");
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });

    await user.click(button);

    // After toggle: light theme → moon visible
    expect(screen.getByTestId("icon-moon")).not.toHaveAttribute("aria-hidden", "true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("persists theme to localStorage on toggle", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });

    await user.click(button);

    expect(localStorage.getItem("obt-theme")).toBe("dark");
  });

  it("sets cookie on toggle for server-side read", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });

    await user.click(button);

    expect(document.cookie).toContain("obt-theme=dark");
  });

  it("reads initial theme from localStorage when available", () => {
    localStorage.setItem("obt-theme", "dark");
    // document theme is light, but localStorage should take priority → dark theme
    render(<ThemeToggle />);
    // Dark theme → sun visible, moon hidden
    expect(screen.getByTestId("icon-sun")).not.toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to system preference when no stored theme", () => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("obt-theme");
    setupSystemPreference(true); // system prefers dark

    render(<ThemeToggle />);
    // System prefers dark → sun visible
    expect(screen.getByTestId("icon-sun")).not.toHaveAttribute("aria-hidden", "true");
  });

  it("defaults to light when no stored theme and system prefers light", () => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("obt-theme");
    setupSystemPreference(false); // system prefers light

    render(<ThemeToggle />);
    // Default light → moon visible
    expect(screen.getByTestId("icon-moon")).not.toHaveAttribute("aria-hidden", "true");
  });

  it("toggles through multiple cycles correctly", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });

    // light → dark
    await user.click(button);
    expect(document.documentElement.dataset.theme).toBe("dark");

    // dark → light
    await user.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("has proper aria-label for accessibility", () => {
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: /toggle theme/i })
    ).toBeInTheDocument();
  });
});
