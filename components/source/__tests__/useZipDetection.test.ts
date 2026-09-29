import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useZipDetection } from "../useZipDetection";

/**
 * Create a mock ZIP File from raw bytes.
 * We'll construct valid local file headers for testing.
 */
function createZipFile(
  entries: Array<{ encrypted: boolean; name: string; compressedSize: number }>,
): File {
  const parts: Uint8Array[] = [];

  for (const entry of entries) {
    const header = new ArrayBuffer(30);
    const view = new DataView(header);

    // Local file header signature: 0x04034b50
    view.setUint32(0, 0x04034b50, true); // signature
    view.setUint16(6, entry.encrypted ? 0x0001 : 0x0000, true); // GPBF
    view.setUint32(18, entry.compressedSize, true); // compressed size
    view.setUint16(26, entry.name.length, true); // file name length
    view.setUint16(28, 0, true); // extra field length

    parts.push(new Uint8Array(header));

    // File name
    const encoder = new TextEncoder();
    parts.push(encoder.encode(entry.name));

    // Compressed data (dummy)
    parts.push(new Uint8Array(entry.compressedSize));
  }

  // Calculate total size
  const totalSize = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const buffer = new Uint8Array(totalSize);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.byteLength;
  }

  const file = new File([buffer], "test.zip", { type: "application/zip" });

  // Override size to match actual buffer
  Object.defineProperty(file, "size", { value: totalSize, writable: false });

  // Spy on arrayBuffer to ensure it returns our buffer
  vi.spyOn(file, "arrayBuffer").mockResolvedValue(buffer.buffer);

  return file;
}

describe("useZipDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns isEncrypted=false and isChecking=false initially when file is null", async () => {
    const { result } = renderHook(() => useZipDetection(null));

    expect(result.current.isEncrypted).toBe(false);
    expect(result.current.isChecking).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it("returns isEncrypted=false for non-ZIP files (e.g. .tar.gz)", async () => {
    const tarFile = new File(["not-a-zip"], "archive.tar.gz", {
      type: "application/gzip",
    });
    vi.spyOn(tarFile, "arrayBuffer").mockResolvedValue(
      new TextEncoder().encode("not-a-zip").buffer,
    );

    const { result } = renderHook(() => useZipDetection(tarFile));

    // Should set isChecking briefly then finish
    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isEncrypted).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it("returns isEncrypted=false for unencrypted ZIP", async () => {
    const zip = createZipFile([
      { encrypted: false, name: "file1.txt", compressedSize: 10 },
    ]);

    const { result } = renderHook(() => useZipDetection(zip));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isEncrypted).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it("returns isEncrypted=true for encrypted ZIP", async () => {
    const zip = createZipFile([
      { encrypted: true, name: "secret.txt", compressedSize: 10 },
    ]);

    const { result } = renderHook(() => useZipDetection(zip));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isEncrypted).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("detects encryption when any entry is encrypted", async () => {
    const zip = createZipFile([
      { encrypted: false, name: "public.txt", compressedSize: 5 },
      { encrypted: true, name: "secret.txt", compressedSize: 10 },
    ]);

    const { result } = renderHook(() => useZipDetection(zip));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isEncrypted).toBe(true);
  });

  it("returns isEncrypted=false when all entries are unencrypted", async () => {
    const zip = createZipFile([
      { encrypted: false, name: "a.txt", compressedSize: 3 },
      { encrypted: false, name: "b.txt", compressedSize: 7 },
    ]);

    const { result } = renderHook(() => useZipDetection(zip));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isEncrypted).toBe(false);
  });

  it("handles corrupted/invalid ZIP gracefully", async () => {
    const badFile = new File(["garbage"], "invalid.zip", {
      type: "application/zip",
    });
    vi.spyOn(badFile, "arrayBuffer").mockResolvedValue(
      new TextEncoder().encode("not-a-valid-zip-at-all-garbage").buffer,
    );

    const { result } = renderHook(() => useZipDetection(badFile));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isEncrypted).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it("resets state when file changes to null", async () => {
    const zip = createZipFile([
      { encrypted: true, name: "x.txt", compressedSize: 10 },
    ]);

    const { result, rerender } = renderHook(
      ({ file }: { file: File | null }) => useZipDetection(file),
      { initialProps: { file: zip as File | null } },
    );

    await waitFor(() => {
      expect(result.current.isEncrypted).toBe(true);
    });

    // Change to null
    rerender({ file: null });

    expect(result.current.isEncrypted).toBe(false);
    expect(result.current.isChecking).toBe(false);
    expect(result.current.error).toBe(null);
  });
});
