"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"

interface SarifImportDropzoneProps {
  /** Scan ID to import findings into */
  scanId: string
  /** Called after successful import */
  onImported?: (result: {
    imported: number
    skipped: number
    capped: boolean
    toolName: string
  }) => void
}

interface ImportResult {
  imported: number
  skipped: number
  capped: boolean
  toolName: string
}

/**
 * Dropzone for importing a SARIF file into an existing scan.
 *
 * Accepts file selection via input or drag-and-drop.
 * POSTs to /api/scans/{scanId}/sarif-import.
 *
 * @param props.scanId - Scan to import findings into
 * @param props.onImported - Callback on success
 */
export function SarifImportDropzone({ scanId, onImported }: SarifImportDropzoneProps) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const text = await file.text()
      const res = await fetch(`/api/scans/${scanId}/sarif-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: "Import failed" } }))
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
      }

      const body = await res.json()
      const importResult: ImportResult = body.data
      setResult(importResult)
      onImported?.(importResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed")
    } finally {
      setLoading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void uploadFile(file)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void uploadFile(file)
  }

  return (
    <div className="space-y-3">
      <div
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? "border-accent bg-accent/5"
            : "border-border hover:border-accent/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-3 text-fg/40"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>

        <p className="mb-1 text-sm font-medium text-fg">
          Drop SARIF file here
        </p>
        <p className="mb-4 text-xs text-fg/50">
          Supports SARIF 2.1.0 — up to 10,000 findings
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          {loading ? "Importing..." : "Choose file"}
        </Button>

        <input
          ref={inputRef}
          type="file"
          accept=".sarif,.json"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-md bg-accent/10 px-3 py-2 text-sm text-fg">
          <span className="font-medium">
            Imported {result.imported} finding{result.imported === 1 ? "" : "s"}
          </span>
          {result.skipped > 0 && (
            <span className="text-fg/60"> · {result.skipped} duplicates skipped</span>
          )}
          {result.capped && (
            <span className="text-amber-600"> · 10k cap reached</span>
          )}
          {result.toolName && (
            <span className="text-fg/60"> from {result.toolName}</span>
          )}
        </div>
      )}
    </div>
  )
}
