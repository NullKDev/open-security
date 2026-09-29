"use client";

import { useState, useEffect, useCallback } from "react";

export interface ZipDetectionState {
  /** Whether the ZIP file is password-protected */
  isEncrypted: boolean;
  /** Whether detection is in progress */
  isChecking: boolean;
  /** Error message if detection failed */
  error: string | null;
}

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

/**
 * Check if a ZIP file is password-protected by inspecting
 * the general purpose bit flag of each local file header.
 *
 * Bit 0 of the GPBF indicates encryption (traditional PKWARE).
 *
 * @param file - The ZIP File object to inspect
 * @returns Promise<boolean> — true if any entry is encrypted
 */
async function checkZipEncryption(file: File): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const maxOffset = buffer.byteLength - 30; // minimum local header size

    let offset = 0;

    while (offset < maxOffset) {
      const signature = view.getUint32(offset, true);
      if (signature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
        // Not a local file header — reached end or malformed
        break;
      }

      // General purpose bit flag at offset + 6
      const gpBitFlag = view.getUint16(offset + 6, true);
      // Bit 0 = encrypted
      if (gpBitFlag & 0x1) {
        return true;
      }

      // Calculate next entry offset
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraFieldLength = view.getUint16(offset + 28, true);

      offset += 30 + fileNameLength + extraFieldLength + compressedSize;
    }

    return false;
  } catch {
    // Not a valid ZIP or read error — treat as not encrypted
    return false;
  }
}

/**
 * Hook that detects whether a ZIP file is password-protected.
 * Runs automatically when `file` changes.
 *
 * @param file - The ZIP File to check (null = skip)
 * @returns ZipDetectionState with isEncrypted, isChecking, error
 */
export function useZipDetection(file: File | null): ZipDetectionState {
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async (f: File) => {
    // Quick pre-check: is this likely a ZIP file?
    const name = f.name.toLowerCase();
    const type = f.type.toLowerCase();
    const likelyZip =
      name.endsWith(".zip") || type === "application/zip";

    if (!likelyZip) {
      setIsEncrypted(false);
      setIsChecking(false);
      setError(null);
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      const encrypted = await checkZipEncryption(f);
      setIsEncrypted(encrypted);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to read ZIP file";
      setError(msg);
      setIsEncrypted(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (file) {
      detect(file);
    } else {
      setIsEncrypted(false);
      setIsChecking(false);
      setError(null);
    }
  }, [file, detect]);

  return { isEncrypted, isChecking, error };
}
