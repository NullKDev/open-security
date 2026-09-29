"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ExportPanelProps {
  findingId: string;
  scanId: string;
  /** JSON { target, message, at } or null */
  lastExportError?: string | null;
}

/**
 * Export actions panel for a finding.
 *
 * Provides three export actions:
 * 1. "Export to Jira" — POST /api/findings/[id]/export/jira → shows Jira key link
 * 2. "Upload SARIF" — POST /api/scans/[id]/export/github-sarif → shows upload ID
 * 3. "Copy JSON" — copies finding metadata to clipboard
 *
 * Shows last_export_error if present as a yellow warning badge.
 *
 * @param findingId - The finding's primary key
 * @param scanId - The scan that contains this finding (for SARIF export)
 * @param lastExportError - JSON string of last export error or null
 */
export function ExportPanel({
  findingId,
  scanId,
  lastExportError,
}: ExportPanelProps) {
  const [jiraKey, setJiraKey] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [sarifLoading, setSarifLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  let exportError: { target: string; message: string; at: string } | null =
    null;
  if (lastExportError) {
    try {
      exportError = JSON.parse(lastExportError) as {
        target: string;
        message: string;
        at: string;
      };
    } catch {
      // Ignore parse errors
    }
  }

  async function handleExportJira() {
    if (jiraLoading) return;
    setJiraLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/export/jira`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        success: boolean;
        data?: { jiraKey: string };
        error?: { message: string };
      };
      if (body.success && body.data?.jiraKey) {
        setJiraKey(body.data.jiraKey);
      } else {
        setError(body.error?.message ?? "Export failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setJiraLoading(false);
    }
  }

  async function handleUploadSarif() {
    if (sarifLoading) return;
    setSarifLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/export/github-sarif`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        success: boolean;
        data?: { uploadId: string };
        error?: { message: string };
      };
      if (body.success && body.data?.uploadId) {
        setUploadId(body.data.uploadId);
      } else {
        setError(body.error?.message ?? "Upload failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setSarifLoading(false);
    }
  }

  async function handleCopyJson() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ findingId, scanId }, null, 2),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Export</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Export error from DB */}
        {exportError && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="bg-yellow-50 text-yellow-800 border-yellow-300 cursor-default"
                >
                  ⚠ Last export failed ({exportError.target})
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs max-w-xs">{exportError.message}</p>
                <p className="text-xs text-gray-400 mt-1">{exportError.at}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Runtime error */}
        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {/* Jira export */}
          {jiraKey ? (
            <Badge variant="default" className="bg-blue-100 text-blue-800">
              Jira: {jiraKey}
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJira}
              disabled={jiraLoading}
            >
              {jiraLoading ? "Exporting…" : "Export to Jira"}
            </Button>
          )}

          {/* SARIF upload */}
          {uploadId ? (
            <Badge variant="secondary">
              SARIF uploaded
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUploadSarif}
              disabled={sarifLoading}
            >
              {sarifLoading ? "Uploading…" : "Upload SARIF"}
            </Button>
          )}

          {/* Copy JSON */}
          <Button variant="ghost" size="sm" onClick={handleCopyJson}>
            {copied ? "Copied!" : "Copy JSON"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
