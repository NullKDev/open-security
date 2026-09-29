"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { SourceType } from "@/lib/types/source";

type RemoteModeProps = {
  value: string;
  onChange: (url: string) => void;
  /** Called on blur with the URL to trigger server-side validation */
  onValidate: (url: string) => void;
  /** Whether a server-side validation call is in progress */
  isDetecting?: boolean;
  /** Whether server validation succeeded */
  isValidated?: boolean;
  /** Server validation reason message (on failure) */
  validationReason?: string | null;
  /** Current error message (local or server) */
  error?: string | null;
  /** Detected source type from hostname (shown as badge) */
  detectedType?: SourceType | null;
  /** Whether the remote repository is inaccessible (private, no credentials) */
  noAccess?: boolean;
  /** Suggested alternative when noAccess is true */
  suggestion?: string | null;
};

const BADGE_STYLES: Record<SourceType, string> = {
  github: "bg-[var(--success)]/15 text-[var(--success)]",
  gitlab: "bg-[var(--warning,#e67e22)]/15 text-[var(--warning,#e67e22)]",
  local: "",
  zip: "",
};

const BADGE_LABELS: Record<SourceType, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  local: "Local",
  zip: "ZIP",
};

/**
 * Remote mode: URL input with platform detection badge and validation.
 * Auto-detects GitHub/GitLab from hostname on change (debounced 300ms).
 * Triggers server-side validation on blur.
 */
export function RemoteMode({
  value,
  onChange,
  onValidate,
  isDetecting = false,
  isValidated = false,
  validationReason = null,
  error = null,
  detectedType = null,
  noAccess = false,
  suggestion = null,
}: RemoteModeProps) {
  // Local state for the debounced detection badge
  const [badge, setBadge] = useState<SourceType | null>(null);
  const detectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect platform from hostname (debounced 300ms for badge display)
  const detectFromUrl = useCallback(
    (url: string) => {
      if (detectionTimer.current) clearTimeout(detectionTimer.current);
      detectionTimer.current = setTimeout(() => {
        const trimmed = url.trim();
        if (!trimmed) {
          setBadge(null);
          return;
        }
        try {
          const u = new URL(trimmed);
          if (u.hostname === "github.com") {
            setBadge("github");
          } else if (u.hostname === "gitlab.com" || u.hostname.includes("gitlab")) {
            setBadge("gitlab");
          } else {
            // Valid URL but unknown host — show "Unknown"
            setBadge(null);
          }
        } catch {
          setBadge(null);
        }
      }, 300);
    },
    []
  );

  // Cleanup detection timer on unmount
  useEffect(() => {
    return () => {
      if (detectionTimer.current) clearTimeout(detectionTimer.current);
    };
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      onChange(newUrl);
      detectFromUrl(newUrl);
    },
    [onChange, detectFromUrl]
  );

  const handleBlur = useCallback(() => {
    if (value.trim()) {
      onValidate(value.trim());
    }
  }, [value, onValidate]);

  const errorId = "remote-mode-error";
  const statusId = "remote-mode-status";

  return (
    <div className="space-y-2">
      <label htmlFor="remote-url-input" className="block text-xs font-medium text-fg/60">
        Repository URL
      </label>

      <div className="relative">
        <input
          id="remote-url-input"
          type="url"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="https://github.com/owner/repo"
          aria-label="Repository URL"
          aria-describedby={
            [error ? errorId : "", validationReason ? statusId : ""].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={error ? "true" : undefined}
          className={`w-full h-10 rounded-md border bg-bg px-3 pr-28 text-sm text-fg placeholder:text-fg/30 font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 ${
            error ? "border-[var(--danger,#dc2626)]/50" : "border-border"
          }`}
        />

        {/* Right-side overlays: badge + validation indicators */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
          {/* Validation spinner */}
          {isDetecting && (
            <svg
              className="h-3.5 w-3.5 animate-spin text-fg/30"
              viewBox="0 0 24 24"
              fill="none"
              data-testid="validation-spinner"
              aria-label="Validating"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}

          {/* Green checkmark on valid server validation */}
          {!isDetecting && isValidated && !error && (
            <svg
              className="h-3.5 w-3.5 text-[var(--success,#22c55e)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-label="Validated"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}

          {/* Platform badge — prefers internal detection, falls back to parent-provided type */}
          {(() => {
            const displayBadge = badge ?? detectedType;
            if (displayBadge && displayBadge in BADGE_STYLES && BADGE_STYLES[displayBadge]) {
              return (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${
                    BADGE_STYLES[displayBadge]
                  }`}
                >
                  {BADGE_LABELS[displayBadge]}
                </span>
              );
            }
            return null;
          })()}

          {/* Unknown host badge */}
          {value.trim() && !badge && !detectedType && !isDetecting && !isValidated && !error && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none bg-gray-500/15 text-gray-500">
              Unknown
            </span>
          )}
        </div>
      </div>

      {/* Inline error message */}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[var(--danger,#dc2626)]"
          aria-live="assertive"
        >
          {error}
        </p>
      )}

      {/* Suggestion when repo is inaccessible */}
      {error && noAccess && suggestion && (
        <p
          className="text-xs text-accent/70 mt-1 flex items-center gap-1"
          aria-live="polite"
        >
          <span aria-hidden="true">💡</span>
          {suggestion}
        </p>
      )}

      {/* Validation reason (fail-open message) */}
      {validationReason && !error && (
        <p
          id={statusId}
          className="text-xs text-[var(--warning,#e67e22)]"
          aria-live="polite"
        >
          {validationReason}
        </p>
      )}
    </div>
  );
}
