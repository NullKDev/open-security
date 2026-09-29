"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SourceType, SourceData } from "@/lib/types/source";
import { useSourceValidation } from "./useSourceValidation";
import { useZipDetection } from "./useZipDetection";
import { RemoteMode } from "./RemoteMode";
import { LocalMode } from "./LocalMode";

type SourceDetectedMode = "idle" | "url" | "folder" | "zip";

type SourceInputProps = {
  /** Current source data value (controlled) */
  value?: SourceData;
  /** Called when source data changes */
  onChange?: (data: SourceData) => void;
  /** Called when validation state changes */
  onValidationChange?: (valid: boolean) => void;
  /** Additional CSS classes */
  className?: string;
  /** Initial source type */
  initialType?: SourceType;
  /** Initial source reference */
  initialRef?: string;
};

/**
 * SourceInput — unified smart source input with auto-detection.
 *
 * Replaces the old 2-tab Remote/Local segmented control with a single
 * intelligent input that auto-detects what the user provides:
 * - Paste/type URL → detects GitHub/GitLab → validates via API
 * - Drop folder → folder mode with size check
 * - Drop .zip file → ZIP mode with encryption detection + password input
 * - Click "Browse" → file picker for both folders and ZIPs
 *
 * Both URL input and drop zone are ALWAYS visible — no tabs.
 * Whichever the user uses first determines the active mode.
 */
export function SourceInput({
  value,
  onChange,
  onValidationChange,
  className = "",
  initialType,
  initialRef = "",
}: SourceInputProps) {
  // ── Auto-detected mode ──────────────────────────────────────────
  const [detectedMode, setDetectedMode] = useState<SourceDetectedMode>("idle");

  // Derive initial mode from props
  useEffect(() => {
    const t = initialType ?? value?.sourceType;
    if (t === "github" || t === "gitlab") setDetectedMode("url");
    else if (t === "local") setDetectedMode("folder");
    else if (t === "zip") setDetectedMode("zip");
  }, [initialType, value?.sourceType]);

  // URL input state
  const [urlText, setUrlText] = useState(
    (value?.sourceType === "github" || value?.sourceType === "gitlab")
      ? value.sourceRef
      : initialRef
  );

  // ZIP-related state
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipPassword, setZipPassword] = useState("");
  const zipDetection = useZipDetection(zipFile);

  // ── Validation hook ─────────────────────────────────────────────
  const {
    sourceRef,
    sourceType,
    error,
    isDetecting,
    isValid,
    isValidated,
    validationReason,
    noAccess,
    suggestion,
    sourceData,
    validate,
    setType,
    detectSourceKind,
  } = useSourceValidation({
    initialType: initialType ?? undefined,
    initialRef: initialRef,
  });

  // ── Notify parent: validation changes ───────────────────────────
  const prevValidRef = useRef(isValid);
  useEffect(() => {
    if (prevValidRef.current !== isValid) {
      prevValidRef.current = isValid;
      onValidationChange?.(isValid);
    }
  }, [isValid, onValidationChange]);

  // ── Notify parent: source data changes (build with password if ZIP) ──
  const lastEmittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (sourceData) {
      const dataToEmit: SourceData = {
        ...sourceData,
        ...(sourceData.sourceType === "zip" && zipPassword
          ? { password: zipPassword }
          : {}),
      };
      const key = `${dataToEmit.sourceType}:${dataToEmit.sourceRef}:${dataToEmit.password ?? ""}`;
      if (lastEmittedRef.current !== key) {
        lastEmittedRef.current = key;
        onChange?.(dataToEmit);
      }
    }
  }, [sourceData, zipPassword, onChange]);

  // ── URL input handlers ──────────────────────────────────────────
  const handleUrlChange = useCallback(
    (newUrl: string) => {
      // URL typed or pasted → detect and switch to URL mode
      setUrlText(newUrl);
      if (newUrl.trim()) {
        const detected = detectSourceKind(newUrl.trim());
        if (detected) {
          setDetectedMode("url");
          setType(detected);
        }
      } else if (detectedMode === "url") {
        setDetectedMode("idle");
      }
    },
    [detectSourceKind, setType, detectedMode]
  );

  const handleUrlValidate = useCallback(
    (url: string) => {
      validate(url);
    },
    [validate]
  );

  const detectedTeamType = detectSourceKind(urlText);

  // ── File/folder drop and picker handlers ────────────────────────
  const handleLocalSelect = useCallback(
    (path: string, type: SourceType) => {
      if (!path) {
        // Cleared
        setDetectedMode("idle");
        setZipFile(null);
        setZipPassword("");
        return;
      }

      setDetectedMode(type === "zip" ? "zip" : "folder");
      setType(type);
      setUrlText(""); // Clear URL when local source selected

      if (type === "zip") {
        // We need the actual File object for encryption detection.
        // The LocalMode component passed the path but we need the File.
        // We store null here — LocalMode has password handling internally.
        // The actual File object is not passed to SourceInput from LocalMode.
        // For ZIP password, LocalMode handles it directly.
      }

      if (path) {
        validate(path, type);
      }
    },
    [validate, setType]
  );

  const handleClear = useCallback(() => {
    setDetectedMode("idle");
    setUrlText("");
    setZipFile(null);
    setZipPassword("");
    setType("github"); // Reset type
    lastEmittedRef.current = null;
  }, [setType]);

  return (
    <div className={className}>
      {/* ── Unified prompt (no tabs) ──────────────────────────────── */}
      <p className="text-xs text-fg/50 mb-3">
        📋 Paste a Git URL — or — drop a folder / ZIP file
      </p>

      {/* ── 1. URL input (always visible) ─────────────────────────── */}
      <div className="space-y-3 mb-4">
        <RemoteMode
          value={urlText}
          onChange={handleUrlChange}
          onValidate={handleUrlValidate}
          isDetecting={isDetecting && detectedMode === "url"}
          isValidated={isValidated && detectedMode === "url"}
          validationReason={
            detectedMode === "url" ? validationReason : null
          }
          error={detectedMode === "url" ? error : null}
          detectedType={detectedTeamType}
          noAccess={noAccess}
          suggestion={suggestion}
        />
      </div>

      {/* ── Separator ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[11px] text-fg/30 uppercase tracking-wider">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* ── 2. Drop zone + file pickers (always visible) ──────────── */}
      <LocalMode
        onSelect={handleLocalSelect}
        isDetecting={
          isDetecting &&
          (detectedMode === "folder" || detectedMode === "zip")
        }
        isValidated={
          isValidated &&
          (detectedMode === "folder" || detectedMode === "zip")
        }
        validationReason={
          detectedMode === "folder" || detectedMode === "zip"
            ? validationReason
            : null
        }
        error={
          detectedMode === "folder" || detectedMode === "zip"
            ? error
            : null
        }
        value={detectedMode === "folder" || detectedMode === "zip" ? sourceRef : ""}
        selectedType={
          detectedMode === "folder"
            ? "local"
            : detectedMode === "zip"
              ? "zip"
              : null
        }
        isZipEncrypted={zipDetection.isEncrypted}
        isCheckingZip={zipDetection.isChecking}
        onPasswordChange={setZipPassword}
      />

      {/* ── Clear button (when something is selected) ─────────────── */}
      {detectedMode !== "idle" && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-fg/40 hover:text-fg/70 transition-colors"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
