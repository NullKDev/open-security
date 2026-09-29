"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone, type FileRejection, type DropEvent } from "react-dropzone";
import type { SourceType } from "@/lib/types/source";

type LocalModeProps = {
  /** Called when user selects a folder or ZIP file */
  onSelect: (path: string, type: SourceType) => void;
  /** Whether server-side validation is in progress */
  isDetecting?: boolean;
  /** Whether server validation succeeded */
  isValidated?: boolean;
  /** Server validation reason message */
  validationReason?: string | null;
  /** Current error message */
  error?: string | null;
  /** Currently selected path (controlled) */
  value?: string;
  /** Currently selected type (detected: "local" or "zip") */
  selectedType?: SourceType | null;
  /** Whether a ZIP is password-protected (from useZipDetection) */
  isZipEncrypted?: boolean;
  /** Whether ZIP encryption detection is running */
  isCheckingZip?: boolean;
  /** Called when ZIP password changes */
  onPasswordChange?: (password: string) => void;
};

/**
 * Drop zone + file/folder pickers for local sources.
 * Handles BOTH folder and ZIP file drops via react-dropzone
 * with custom `getFilesFromEvent` for proper directory entry handling.
 *
 * Fixes the bug where `accept: undefined` rejected directory drops
 * because react-dropzone couldn't traverse DataTransferItem entries.
 */
export function LocalMode({
  onSelect,
  isDetecting = false,
  isValidated = false,
  validationReason = null,
  error = null,
  value = "",
  selectedType = null,
  isZipEncrypted = false,
  isCheckingZip = false,
  onPasswordChange,
}: LocalModeProps) {
  const [selectedPath, setSelectedPath] = useState(value);
  const [dragError, setDragError] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const [folderFallback, setFolderFallback] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  // Track last selected type internally so "Change selection" knows what to clear
  const lastTypeRef = useRef<SourceType | null>(null);

  // Detect webkitdirectory support for folder picker
  useEffect(() => {
    if (folderInputRef.current) {
      const supported = "webkitdirectory" in folderInputRef.current;
      setFolderFallback(!supported);
    }
  }, []);

  const resetState = useCallback(() => {
    setSelectedPath("");
    setSizeWarning(null);
    setDragError(null);
  }, []);

  const handlePathChange = useCallback(
    (path: string, type: SourceType) => {
      setSelectedPath(path);
      setDragError(null);
      lastTypeRef.current = type;
      onSelect(path, type);
    },
    [onSelect]
  );

  /**
   * Recursively traverse a directory entry to collect files.
   * Used by getFilesFromEvent for dropped directories.
   */
  async function traverseDirectoryEntry(
    entry: FileSystemDirectoryEntry
  ): Promise<File[]> {
    const files: File[] = [];
    const reader = entry.createReader();

    const readAllEntries = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });

    let entries = await readAllEntries();
    // Keep reading until empty (directories may have many entries)
    while (entries.length > 0) {
      for (const child of entries) {
        if (child.isFile) {
          const file = await new Promise<File>((resolve) => {
            (child as FileSystemFileEntry).file(resolve);
          });
          files.push(file);
        } else if (child.isDirectory) {
          const subFiles = await traverseDirectoryEntry(
            child as FileSystemDirectoryEntry
          );
          files.push(...subFiles);
        }
      }
      entries = await readAllEntries();
    }

    return files;
  }

  /**
   * Custom file extraction for react-dropzone.
   * Handles both regular files AND directories via
   * DataTransferItem.webkitGetAsEntry().
   *
   * FIX: This solves the folder drop rejection bug where
   * react-dropzone with `accept: undefined` rejected directory
   * drags because it couldn't traverse DataTransferItem entries.
   */
  // react-dropzone accepts DropEvent = DragEvent | Event | ChangeEvent
  // We only handle DragEvent cases (for drag-and-drop with dataTransfer)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getFilesFromEvent = useCallback(
    async (event: DropEvent) => {
      const dt =
        "dataTransfer" in event
          ? (event as React.DragEvent<HTMLElement> | DragEvent).dataTransfer
          : null;
      if (!dt) return [];

      const items = dt.items;
      if (!items) return [];

      const files: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;

        // Try webkitGetAsEntry for directory detection
        // We only need the first file/folder for display name
        break;
      }

      // Use the first item to determine if it's a file or directory
      const firstItem = items[0];
      if (firstItem && firstItem.kind === "file") {
        // Check if this is a directory entry
        const entry = firstItem.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          // Directory drop — collect files for size check
          const dirFiles = await traverseDirectoryEntry(
            entry as FileSystemDirectoryEntry
          );
          // Use the directory entry name for display
          // Create a synthetic file with directory name for the dropzone to accept
          const dirName = entry.name;
          const dirFile = new File([], dirName, {
            type: "application/x-directory",
          });
          // Attach the actual files for size calculation
          (dirFile as File & { _directoryFiles?: File[] })._directoryFiles = dirFiles;
          return [dirFile];
        } else {
          // Regular file — get it normally
          const file = entry ? await new Promise<File | null>((resolve) => {
            (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
          }) : firstItem.getAsFile();
          return file ? [file] : [];
        }
      }

      // Fallback: use getAsFile
      const file = firstItem?.getAsFile();
      return file ? [file] : [];
    },
    []
  );

  // react-dropzone: accept both .zip and directory drops
  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (fileRejections.length > 0) {
        setDragError("Only .zip files and folders accepted");
        return;
      }

      const file = acceptedFiles[0];
      if (!file) return;

      // Determine type from file
      const isZip =
        file.name.toLowerCase().endsWith(".zip") ||
        file.type === "application/zip";
      const fileType: SourceType = isZip ? "zip" : "local";

      // For directory drops, use the entry name
      const displayPath = file.name;
      handlePathChange(displayPath, fileType);

      // Check size for warnings
      const dirFiles = (file as File & { _directoryFiles?: File[] })._directoryFiles;
      const totalSize = dirFiles
        ? dirFiles.reduce((sum, f) => sum + f.size, 0)
        : file.size;

      if (totalSize > 209_715_200) {
        setSizeWarning("Source exceeds 200 MB. Scanning may take longer.");
      }
    },
    [handlePathChange]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    getFilesFromEvent,
    // Accept both ZIP files and any other file types (for directories)
    accept: {
      "application/zip": [".zip"],
      "application/x-directory": [],
      // Allow any file for directory drops
      "*/*": [],
    },
    multiple: false,
    noClick: true,
    noKeyboard: true,
  });

  const handleFolderClick = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const handleZipClick = useCallback(() => {
    zipInputRef.current?.click();
  }, []);

  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        // webkitRelativePath gives the folder name
        const folderName =
          files[0].webkitRelativePath?.split("/")[0] ?? files[0].name;
        handlePathChange(folderName, "local");
        // Sum file sizes
        const totalSize = Array.from(files).reduce((sum, f) => sum + f.size, 0);
        if (totalSize > 209_715_200) {
          setSizeWarning("Source exceeds 200 MB. Scanning may take longer.");
        }
      }
    },
    [handlePathChange]
  );

  const handleZipChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const file = files[0];
        handlePathChange(file.name, "zip");
        if (file.size > 209_715_200) {
          setSizeWarning("Source exceeds 200 MB. Scanning may take longer.");
        }
      }
    },
    [handlePathChange]
  );

  const handleManualPathChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handlePathChange(e.target.value, "local");
    },
    [handlePathChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        // Default to folder picker on Enter/Space
        folderInputRef.current?.click();
      }
    },
    []
  );

  const errorId = "local-mode-error";
  const statusId = "local-mode-status";

  const dropStyles = `rounded-lg border-2 border-dashed transition-colors duration-[120ms] p-6 text-center cursor-pointer ${
    isDragActive
      ? "border-accent bg-accent/5"
      : dragError
        ? "border-[var(--danger,#dc2626)]/50 bg-[var(--danger,#dc2626)]/5"
        : selectedPath
          ? "border-[var(--success,#22c55e)]/50 bg-[var(--surface)]"
          : "border-border bg-[var(--surface)] hover:border-fg/20"
  }`;

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-fg/60">
        Drop folder or ZIP file
      </label>

      {/* Drop zone — handles both folders and ZIP */}
      <div
        {...getRootProps()}
        role="button"
        tabIndex={0}
        aria-label="Drop folder or ZIP file, or click to browse"
        aria-describedby={
          [error ? errorId : "", dragError ? "drag-error" : "", statusId]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onKeyDown={handleKeyDown}
        className={dropStyles}
      >
        <input {...getInputProps()} />

        {selectedPath ? (
          <div className="flex flex-col items-center gap-2">
            {/* Folder or ZIP icon */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--success,#22c55e)]"
            >
              {selectedType === "zip" ? (
                <>
                  <path d="M21 8v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                  <line x1="10" y1="14" x2="14" y2="14" />
                </>
              ) : (
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              )}
            </svg>
            <p className="text-sm font-medium text-fg truncate max-w-full">
              {selectedPath}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const prevType = lastTypeRef.current ?? selectedType ?? "local";
                resetState();
                lastTypeRef.current = null;
                onSelect("", prevType);
              }}
              className="text-xs text-fg/40 hover:text-fg/70 transition-colors"
            >
              Change selection
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-fg/25 mb-1"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-sm text-fg/40">
                {isDragActive
                  ? "Drop here"
                  : "Drag a folder or .zip file, or click below to browse"}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Drag error */}
      {dragError && (
        <p
          id="drag-error"
          role="alert"
          aria-live="assertive"
          className="text-xs text-[var(--danger,#dc2626)]"
        >
          {dragError}
        </p>
      )}

      {/* Size warning (non-blocking) */}
      {sizeWarning && selectedPath && (
        <p
          id="size-warning"
          role="status"
          aria-live="polite"
          className="text-xs text-[var(--warning,#e67e22)] flex items-center gap-1"
        >
          <span aria-hidden="true">⚠️</span>
          {sizeWarning}
        </p>
      )}

      {/* ZIP encryption check indicator */}
      {selectedType === "zip" && isCheckingZip && (
        <p className="text-xs text-fg/40 flex items-center gap-1.5">
          <svg
            className="h-3 w-3 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Checking encryption...
        </p>
      )}

      {/* ZIP password input (only if encrypted) */}
      {selectedType === "zip" && isZipEncrypted && selectedPath && (
        <div className="space-y-1">
          <label
            htmlFor="zip-password"
            className="block text-xs font-medium text-[var(--warning,#e67e22)]"
          >
            🔒 ZIP is password-protected
          </label>
          <input
            id="zip-password"
            type="password"
            placeholder="Enter password"
            aria-label="ZIP file password"
            onChange={(e) => onPasswordChange?.(e.target.value)}
            className="w-full h-8 rounded-md border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      )}

      {/* Action buttons — both always visible */}
      {!selectedPath && (
        <div className="flex gap-2">
          {/* Folder picker or manual fallback */}
          {!folderFallback ? (
            <>
              <input
                ref={folderInputRef}
                type="file"
                // @ts-expect-error - webkitdirectory is non-standard
                webkitdirectory=""
                directory=""
                className="hidden"
                onChange={handleFolderChange}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={handleFolderClick}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border bg-[var(--surface)] px-3 text-xs font-medium text-fg/60 hover:text-fg hover:border-fg/20 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Choose Folder
              </button>
            </>
          ) : (
            <div className="flex-1 space-y-1">
              <label htmlFor="manual-folder-path" className="text-xs text-fg/50">
                Enter folder path
              </label>
              <input
                id="manual-folder-path"
                type="text"
                value={selectedPath}
                onChange={handleManualPathChange}
                placeholder="/path/to/project"
                aria-label="Folder path"
                className="w-full h-8 rounded-md border border-border bg-bg px-3 text-sm text-fg font-mono placeholder:text-fg/30 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
          )}

          {/* ZIP file picker */}
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleZipChange}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={handleZipClick}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border bg-[var(--surface)] px-3 text-xs font-medium text-fg/60 hover:text-fg hover:border-fg/20 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2z" />
            </svg>
            Choose ZIP File
          </button>
        </div>
      )}

      {/* Validation spinner */}
      {isDetecting && (
        <div className="flex items-center gap-2 text-xs text-fg/40">
          <svg
            className="h-3.5 w-3.5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            data-testid="validation-spinner"
            aria-label="Validating"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Validating...
        </div>
      )}

      {/* Green check on validation success */}
      {!isDetecting && isValidated && !error && selectedPath && (
        <div
          className="flex items-center gap-1.5 text-xs text-[var(--success,#22c55e)]"
          aria-live="polite"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Source validated
        </div>
      )}

      {/* Validation reason (fail-open) */}
      {validationReason && !error && selectedPath && (
        <p
          id={statusId}
          className="text-xs text-[var(--warning,#e67e22)]"
          aria-live="polite"
        >
          {validationReason}
        </p>
      )}

      {/* Error */}
      {error && (
        <p
          id={errorId}
          role="alert"
          aria-live="assertive"
          className="text-xs text-[var(--danger,#dc2626)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
