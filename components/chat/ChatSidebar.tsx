"use client";

import { useState } from "react";

export function ChatSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-fg/60 shadow-sm hover:text-fg hover:border-accent/50 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2"
        aria-label={open ? "Close chat" : "Open chat"}
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
          />
        </svg>
      </button>

      {/* Sidebar panel */}
      <aside
        className={`fixed top-0 right-0 z-40 h-full w-80 border-l border-border bg-surface shadow-lg transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-fg">Chat</h2>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-fg/40 hover:text-fg transition-colors focus-visible:ring-2 focus-visible:ring-accent/30"
              aria-label="Close chat"
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-fg/40 text-center">
              Chat coming in v0.2
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
