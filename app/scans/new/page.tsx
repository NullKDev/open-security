"use client";

import { useState, useCallback, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SourceInput } from "@/components/source/SourceInput";
import { ScanModePicker } from "@/components/ui/ScanModePicker";
import { ModelsInfoCard } from "@/components/ui/ModelsInfoCard";
import type { SourceData } from "@/lib/types/source";
import type { ScanMode } from "@/lib/repos/scans.repo";

export default function NewScanPage() {
  const router = useRouter();
  const [sourceData, setSourceData] = useState<SourceData | undefined>();
  const [isSourceValid, setIsSourceValid] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("standard");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modelsJson, setModelsJson] = useState<string | null>(null);

  // Fetch current model config to show as info
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.models) {
          setModelsJson(JSON.stringify(d.data.models));
        }
      })
      .catch(() => {});
  }, []);

  const handleSourceChange = useCallback((data: SourceData) => {
    setSourceData(data);
  }, []);

  const handleValidationChange = useCallback((valid: boolean) => {
    setIsSourceValid(valid);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!sourceData?.sourceRef.trim()) {
      setError("Please enter a source.");
      return;
    }

    setLoading(true);

    try {
      const body: Record<string, string> = {
        sourceType: sourceData.sourceType,
        sourceRef: sourceData.sourceRef,
        scanMode,
      };
      if (prompt.trim()) body.prompt = prompt.trim();

      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error?.message || "Failed to start scan.");
        return;
      }

      router.push(`/scans/${data.data.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-fg">New Scan</h1>

      <Card className="px-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          <SourceInput
            onChange={handleSourceChange}
            onValidationChange={handleValidationChange}
          />

          <ScanModePicker value={scanMode} onChange={setScanMode} />

          <ModelsInfoCard modelsJson={modelsJson} />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg/80">
              Focus prompt <span className="text-fg/40 font-normal">(optional)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Only scan the authentication module for vulnerabilities"
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:ring-1 focus:ring-accent/60"
            />
            <p className="text-xs text-fg/40">
              Tell the AI what to focus on. Leave empty for a full security scan.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
              disabled={!isSourceValid}
            >
              Start Scan
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
