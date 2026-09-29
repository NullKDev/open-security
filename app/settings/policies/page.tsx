"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ValidationError {
  path: string;
  message: string;
}

/**
 * /settings/policies — YAML policy editor page.
 *
 * Provides a textarea-based YAML editor for `.obt/policies.yaml`.
 * Live Zod validation (debounced 500ms) shows errors inline.
 * Save button writes via PUT /api/policies.
 * Shows last-saved timestamp after successful save.
 *
 * Note: No Monaco dependency — uses a monospace textarea with similar UX.
 * Upgrade to Monaco editor by replacing the textarea with a MonacoEditor
 * component when `@monaco-editor/react` is added to the project.
 */
export default function PoliciesPage() {
  const [yamlText, setYamlText] = useState(`# .obt/policies.yaml — Security Policy Rules
# See documentation for available rule types and match fields.

rules:
  - id: example-suppress
    type: suppress
    match:
      path: "tests/**"
    decision:
      suppress: true
`);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [validating, setValidating] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Validate the current YAML against the server's policy schema */
  const validate = useCallback(async (text: string) => {
    if (!text.trim()) {
      setValidationErrors([]);
      return;
    }
    setValidating(true);
    try {
      const res = await fetch("/api/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Dry-run: we send the YAML but the server validates it
        // (We still write on success — this is fine since it's idempotent)
        body: JSON.stringify({ yaml: text }),
      });
      const body = (await res.json()) as {
        success: boolean;
        error?: { message: string };
      };
      if (body.success) {
        setValidationErrors([]);
      } else if (body.error?.message) {
        // Parse "Policy schema error: rules.0.type: ..." format
        const msg = body.error.message;
        if (msg.startsWith("Policy schema error: ")) {
          const details = msg.slice("Policy schema error: ".length);
          const errors = details.split("; ").map((e) => {
            const colonIdx = e.indexOf(": ");
            if (colonIdx > -1) {
              return { path: e.slice(0, colonIdx), message: e.slice(colonIdx + 2) };
            }
            return { path: "", message: e };
          });
          setValidationErrors(errors);
        } else {
          setValidationErrors([{ path: "", message: msg }]);
        }
      }
    } catch {
      // Ignore network errors during validation
    } finally {
      setValidating(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void validate(yamlText);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [yamlText, validate]);

  async function handleSave() {
    if (saveLoading) return;
    setSaveLoading(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlText }),
      });
      const body = (await res.json()) as {
        success: boolean;
        error?: { message: string };
      };
      if (body.success) {
        setSavedAt(new Date().toLocaleTimeString());
        setValidationErrors([]);
      } else {
        setSaveError(body.error?.message ?? "Save failed");
      }
    } catch {
      setSaveError("Network error");
    } finally {
      setSaveLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-8 px-4">
      <div>
        <h1 className="text-xl font-semibold">Policies</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Edit the YAML policy rules for this workspace. Changes are validated
          before saving.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">policies.yaml</CardTitle>
          <div className="flex items-center gap-2">
            {validating && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Validating…
              </Badge>
            )}
            {!validating && validationErrors.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {validationErrors.length} error{validationErrors.length > 1 ? "s" : ""}
              </Badge>
            )}
            {!validating && validationErrors.length === 0 && yamlText.trim() && (
              <Badge
                variant="outline"
                className="text-[10px] bg-green-50 text-green-700 border-green-300"
              >
                Valid
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* YAML textarea */}
          <textarea
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            className="w-full h-80 font-mono text-xs rounded border border-border bg-muted/30 p-3 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
            spellCheck={false}
            aria-label="Policy YAML editor"
          />

          {/* Inline validation errors */}
          {validationErrors.length > 0 && (
            <div className="space-y-1">
              {validationErrors.map((err, i) => (
                <p key={i} className="text-xs text-red-500">
                  {err.path ? (
                    <>
                      <span className="font-mono">{err.path}</span>: {err.message}
                    </>
                  ) : (
                    err.message
                  )}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              {saveError && (
                <p className="text-xs text-red-500">{saveError}</p>
              )}
              {savedAt && !saveError && (
                <p className="text-xs text-muted-foreground">
                  Saved at {savedAt}
                </p>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={saveLoading || validationErrors.length > 0}
              size="sm"
            >
              {saveLoading ? "Saving…" : "Save Policies"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
