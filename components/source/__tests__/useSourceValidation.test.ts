import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSourceValidation } from "../useSourceValidation";

const originalFetch = globalThis.fetch;

describe("useSourceValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { valid: true } }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  describe("URL format detection", () => {
    it("detects github.com as github", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.detectSourceKind("https://github.com/owner/repo")).toBe("github");
    });

    it("detects gitlab.com as gitlab", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.detectSourceKind("https://gitlab.com/owner/repo")).toBe("gitlab");
    });

    it("detects self-hosted gitlab via gitlab in hostname", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.detectSourceKind("https://gitlab.mycompany.com/project/repo")).toBe("gitlab");
    });

    it("returns github for unrecognized but valid URL", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.detectSourceKind("https://bitbucket.org/owner/repo")).toBe("github");
    });

    it("returns null for invalid URL", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.detectSourceKind("not-a-url")).toBeNull();
    });

    it("returns null for empty string", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.detectSourceKind("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.detectSourceKind("   ")).toBeNull();
    });
  });

  describe("validate() — local validation", () => {
    it("sets error for invalid URL format", async () => {
      const { result } = renderHook(() => useSourceValidation());

      await act(async () => {
        result.current.validate("not-a-valid-url");
      });

      expect(result.current.error).toBe("Enter a valid HTTPS URL");
      expect(result.current.isValid).toBe(false);
    });

    it("clears error for valid HTTPS URL", async () => {
      const { result } = renderHook(() => useSourceValidation());

      await act(async () => {
        result.current.validate("https://github.com/user/repo");
      });

      expect(result.current.error).toBeNull();
      expect(result.current.sourceType).toBe("github");
    });

    it("resets state for empty input", async () => {
      const { result } = renderHook(() => useSourceValidation());

      await act(async () => {
        result.current.validate("");
      });

      expect(result.current.error).toBeNull();
      expect(result.current.sourceType).toBeNull();
    });
  });

  describe("validate() — server-side validation", () => {
    it("calls POST /api/sources with correct body", async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { valid: true } }),
      });

      const { result } = renderHook(() => useSourceValidation({ debounceMs: 0 }));

      await act(async () => {
        result.current.validate("https://github.com/user/repo");
      });

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          "/api/sources",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              sourceType: "github",
              sourceRef: "https://github.com/user/repo",
            }),
          })
        );
      });
    });

    it("sets isValidated=true on server { valid: true }", async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { valid: true } }),
      });

      const { result } = renderHook(() => useSourceValidation({ debounceMs: 0 }));

      await act(async () => {
        result.current.validate("https://github.com/user/repo");
      });

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
        expect(result.current.validationReason).toBeNull();
        expect(result.current.isValid).toBe(true);
      });
    });

    it("sets error on server { valid: false, reason }", async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { valid: false, reason: "Path does not exist" },
        }),
      });

      const { result } = renderHook(() => useSourceValidation({ debounceMs: 0 }));

      await act(async () => {
        result.current.validate("/nonexistent/path", "local" as const);
      });

      await waitFor(() => {
        expect(result.current.error).toBe("Path does not exist");
        expect(result.current.isValid).toBe(false);
        expect(result.current.isValidated).toBe(false);
      });
    });

    it("fail-open on network error", async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useSourceValidation({ debounceMs: 0 }));

      await act(async () => {
        result.current.validate("https://github.com/user/repo");
      });

      await waitFor(() => {
        expect(result.current.validationReason).toBe("Could not validate. Submit anyway?");
        expect(result.current.isValidated).toBe(true);
        expect(result.current.isValid).toBe(true);
      });
    });

    it("fail-open on API non-ok response", async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: { message: "Server error" } }),
      });

      const { result } = renderHook(() => useSourceValidation({ debounceMs: 0 }));

      await act(async () => {
        result.current.validate("https://github.com/user/repo");
      });

      await waitFor(() => {
        expect(result.current.validationReason).toBe("Could not validate. Submit anyway?");
        expect(result.current.isValidated).toBe(true);
      });
    });
  });

  describe("sourceData", () => {
    it("returns null when input is empty", () => {
      const { result } = renderHook(() => useSourceValidation());
      expect(result.current.sourceData).toBeNull();
    });

    it("returns valid SourceData when URL is valid", async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { valid: true } }),
      });

      const { result } = renderHook(() => useSourceValidation({ debounceMs: 0 }));

      await act(async () => {
        result.current.validate("https://github.com/user/repo");
      });

      // sourceType should be detected immediately
      expect(result.current.sourceType).toBe("github");
      expect(result.current.isValid).toBe(true);

      if (result.current.sourceData) {
        expect(result.current.sourceData.sourceType).toBe("github");
        expect(result.current.sourceData.sourceRef).toBe("https://github.com/user/repo");
      }

      await waitFor(() => {
        expect(result.current.isValidated).toBe(true);
      });
    });
  });

  describe("setType", () => {
    it("allows explicit type override", () => {
      const { result } = renderHook(() => useSourceValidation());

      act(() => {
        result.current.setType("zip");
      });

      expect(result.current.sourceType).toBe("zip");
    });
  });
});
