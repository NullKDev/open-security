"use client";

import { useState, useEffect } from "react";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";

  const stored = localStorage.getItem("obt-theme");
  if (stored === "dark" || stored === "light") return stored;

  const htmlTheme = document.documentElement.dataset.theme;
  if (htmlTheme === "dark" || htmlTheme === "light") return htmlTheme;

  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(getInitialTheme());
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("obt-theme", next);
    document.cookie = `obt-theme=${next};path=/;max-age=31536000`;
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="relative flex h-9 w-9 items-center justify-center rounded-md text-fg/80 transition-all duration-[150ms] hover:bg-surface hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      {/* Sun icon (shown when theme is dark — click to switch to light) */}
      <svg
        data-testid="icon-sun"
        aria-hidden={theme === "light"}
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`absolute transition-all duration-[150ms] ${
          theme === "dark"
            ? "scale-100 rotate-0 opacity-100"
            : "scale-75 rotate-90 opacity-0"
        }`}
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>

      {/* Moon icon (shown when theme is light — click to switch to dark) */}
      <svg
        data-testid="icon-moon"
        aria-hidden={theme === "dark"}
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`absolute transition-all duration-[150ms] ${
          theme === "light"
            ? "scale-100 rotate-0 opacity-100"
            : "scale-75 -rotate-90 opacity-0"
        }`}
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}
