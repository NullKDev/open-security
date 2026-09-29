"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { SourceType, SourceData } from "@/lib/types/source";

export interface ValidationState {
  /** Whether the source is currently valid */
  isValid: boolean;
  /** Error message if invalid */
  error: string | null;
  /** Whether server-side validation is in progress */
  isDetecting: boolean;
  /** Detected source type from hostname or user selection */
  sourceType: SourceType | null;
  /** The source reference (URL or path) */
  sourceRef: string;
  /** Whether the source has been server-validated (green checkmark) */
  isValidated: boolean;
  /** Server validation return reason on failure */
  validationReason: string | null;
  /** Whether the repository is inaccessible (private, no credentials) */
  noAccess: boolean;
  /** Suggested alternative action when noAccess is true */
  suggestion: string | null;
}

interface UseSourceValidationOptions {
  /** Initial source type (e.g. "github") */
  initialType?: SourceType;
  /** Initial source reference */
  initialRef?: string;
  /** Debounce delay in ms for API validation calls */
  debounceMs?: number;
}

/**
 * Hook that validates source URLs/paths, detects platform from hostname,
 * and calls POST /api/sources for server-side validation.
 *
 * Returns validation state and a trigger function to call on blur/select.
 */
export function useSourceValidation(options: UseSourceValidationOptions = {}) {
  const { initialType = null, initialRef = "", debounceMs = 500 } = options;

  const [sourceType, setSourceType] = useState<SourceType | null>(initialType);
  const [sourceRef, setSourceRef] = useState(initialRef);
  const [error, setError] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isValidated, setIsValidated] = useState(false);
  const [validationReason, setValidationReason] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (abortController.current) abortController.current.abort();
    };
  }, []);

  /**
   * Detect source kind from URL hostname.
   * Returns null for invalid/malformed URLs.
   */
  const detectSourceKind = useCallback((url: string): SourceType | null => {
    if (!url.trim()) return null;
    try {
      const u = new URL(url);
      if (u.hostname === "github.com") return "github";
      if (u.hostname === "gitlab.com" || u.hostname.includes("gitlab")) return "gitlab";
      // Any valid URL that isn't detected → default to github (most common)
      return "github";
    } catch {
      return null;
    }
  }, []);

  /**
   * Validate locally (URL format check) and optionally call the API.
   *
   * @param ref - The source reference (URL or path)
   * @param type - The source type override (for local/zip which are explicit)
   */
  const validate = useCallback(
    async (ref: string, type?: SourceType) => {
      // Cancel any in-flight validation
      if (abortController.current) abortController.current.abort();
      abortController.current = new AbortController();

      const trimmed = ref.trim();

      // Determine source type
      let resolvedType: SourceType | null = type ?? null;

      // If no explicit type, detect from URL
      if (!resolvedType) {
        resolvedType = detectSourceKind(trimmed);
      }

      setSourceRef(trimmed);
      setSourceType(resolvedType);
      setIsValidated(false);
      setValidationReason(null);
      setNoAccess(false);
      setSuggestion(null);

      // Empty input — no error, just reset
      if (!trimmed) {
        setError(null);
        setIsDetecting(false);
        return;
      }

      // Validate URL format for text that looks like a URL
      const looksLikeUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.includes("://") || trimmed.includes(".");
      
      if (looksLikeUrl) {
        try {
          const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            setError("Enter a valid HTTPS URL");
            setIsDetecting(false);
            return;
          }
        } catch {
          setError("Enter a valid HTTPS URL");
          setIsDetecting(false);
          return;
        }
      } else if (trimmed.length > 0 && !resolvedType) {
        // Non-URL text with no detected type — show error
        setError("Enter a valid HTTPS URL");
        setIsDetecting(false);
        return;
      }

      // Clear local error before server validation
      setError(null);
      setIsDetecting(true);

      // Debounced server-side validation
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      debounceTimer.current = setTimeout(async () => {
        try {
          const res = await fetch("/api/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceType: resolvedType ?? "github",
              sourceRef: trimmed,
            }),
            signal: abortController.current?.signal,
          });

          if (!res.ok) {
            // API error — fail open
            setValidationReason("Could not validate. Submit anyway?");
            setIsValidated(true);
            setIsDetecting(false);
            return;
          }

          const body = await res.json();

          if (body.success && body.data?.valid === true) {
            setIsValidated(true);
            setValidationReason(null);
          } else if (body.success && body.data?.valid === false) {
            setError(body.data.reason ?? "Source is not valid");
            setIsValidated(false);
            setValidationReason(body.data.reason ?? null);

            // Check for no-access flag (private repo, no credentials)
            if (body.data?.noAccess) {
              setNoAccess(true);
              setSuggestion(body.data.suggestion ?? null);
            } else {
              setNoAccess(false);
              setSuggestion(null);
            }
          } else {
            // Unexpected response — fail open
            setValidationReason("Could not validate. Submit anyway?");
            setIsValidated(true);
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Network error — fail open
          setValidationReason("Could not validate. Submit anyway?");
          setIsValidated(true);
        } finally {
          setIsDetecting(false);
        }
      }, debounceMs);
    },
    [detectSourceKind, debounceMs]
  );

  /**
   * Set the source type explicitly (for local/zip modes where type is known).
   */
  const setType = useCallback((type: SourceType) => {
    setSourceType(type);
  }, []);

  const isValid =
    sourceRef.trim().length > 0 &&
    (sourceType !== null) &&
    error === null;

  const sourceData: SourceData | null = useMemo(
    () =>
      isValid && sourceType
        ? { sourceType, sourceRef: sourceRef.trim() }
        : null,
    [isValid, sourceType, sourceRef]
  );

  return {
    // State
    sourceType,
    sourceRef,
    error,
    isDetecting,
    isValid,
    isValidated,
    validationReason,
    noAccess,
    suggestion,
    sourceData,
    // Actions
    validate,
    setType,
    detectSourceKind,
  };
}
