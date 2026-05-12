"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SourceInput } from "@/components/source/SourceInput";
import { ScanConfig, type ScanConfigData } from "@/components/project/ScanConfig";
import type { SourceData } from "@/lib/types/source";

type ModalStep = "source" | "config" | "submitting";

interface NewScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * NewScanModal — two-step modal to create and configure a new scan.
 *
 * Step 1: source input (URL / folder / ZIP via SourceInput)
 * Step 2: scan config (intensity, toggles via ScanConfig)
 *
 * On submit: POST /api/scans → redirect to /scans/[id].
 */
export function NewScanModal({ open, onOpenChange }: NewScanModalProps) {
  const router = useRouter();
  const t = useTranslations("newScan");
  const tCommon = useTranslations("common");

  const [step, setStep] = useState<ModalStep>("source");
  const [sourceData, setSourceData] = useState<SourceData | undefined>();
  const [isSourceValid, setIsSourceValid] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [modelsConfig, setModelsConfig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSourceChange = useCallback((data: SourceData) => {
    setSourceData(data);
  }, []);

  const handleValidationChange = useCallback((valid: boolean) => {
    setIsSourceValid(valid);
  }, []);

  async function handleSourceNext() {
    if (!sourceData || !isSourceValid) return;
    setError(null);
    setStep("submitting");

    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: sourceData.sourceType,
          sourceRef: sourceData.sourceRef,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to create scan");
      }

      const body = await res.json();
      const id: string = body.data?.id ?? body.id;
      const name: string = body.data?.project?.name ?? body.data?.name ?? sourceData.sourceRef;
      const models: string | null = body.data?.project?.modelsConfig ?? null;

      setScanId(id);
      setProjectName(name);
      setModelsConfig(models);
      setStep("config");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setStep("source");
    }
  }

  async function handleConfigSubmit(data: ScanConfigData) {
    if (!scanId) return;
    setStep("submitting");
    onOpenChange(false);
    router.push(`/scans/${scanId}`);
  }

  function handleClose() {
    // Reset state on close so next open starts fresh
    setStep("source");
    setSourceData(undefined);
    setIsSourceValid(false);
    setScanId(null);
    setProjectName("");
    setModelsConfig(null);
    setError(null);
    onOpenChange(false);
  }

  const isSubmitting = step === "submitting";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {step === "config" ? t("step2Title") : t("title")}
          </DialogTitle>
          <DialogDescription>
            {step === "config"
              ? `Choose intensity and options for scanning ${projectName || "your project"}.`
              : "Enter a Git URL, or drop a local folder or ZIP file."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-1">
          <div
            className={`h-1 flex-1 rounded-full transition-colors ${
              step === "source" || step === "config" || step === "submitting"
                ? "bg-accent"
                : "bg-border"
            }`}
          />
          <div
            className={`h-1 flex-1 rounded-full transition-colors ${
              step === "config" || step === "submitting"
                ? "bg-accent"
                : "bg-border"
            }`}
          />
        </div>

        {/* Step 1 — Source */}
        {(step === "source" || (step === "submitting" && !scanId)) && (
          <div className="space-y-4">
            <SourceInput
              value={sourceData}
              onChange={handleSourceChange}
              onValidationChange={handleValidationChange}
            />
            {error && (
              <p className="text-xs text-danger">{error}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
                {tCommon("cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={handleSourceNext}
                disabled={!isSourceValid || isSubmitting}
                loading={isSubmitting}
              >
                {tCommon("next")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2 — Config */}
        {(step === "config" || (step === "submitting" && scanId)) && (
          <ScanConfig
            projectName={projectName}
            modelsConfig={modelsConfig}
            onSubmit={handleConfigSubmit}
            loading={step === "submitting"}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
