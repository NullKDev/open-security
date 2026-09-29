"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SarifImportDropzone } from "./SarifImportDropzone"

interface SarifImportButtonProps {
  /** Scan ID to import into */
  scanId: string
}

/**
 * Compact import button that expands into the import dropzone on click.
 *
 * Used on the /findings page header to allow importing SARIF files
 * into the most recent scan without leaving the page.
 *
 * @param props.scanId - The scan to import findings into
 */
export function SarifImportButton({ scanId }: SarifImportButtonProps) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        Import SARIF
      </Button>
    )
  }

  return (
    <div className="w-full max-w-md">
      <SarifImportDropzone
        scanId={scanId}
        onImported={() => setOpen(false)}
      />
      <button
        className="mt-2 text-xs text-fg/40 hover:text-fg/70"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </div>
  )
}
