"use client";

import { useState } from "react";
import type { Playbook } from "@/lib/playbooks/schema";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface PlaybookParamFormProps {
  /** The playbook whose parameters need to be filled. */
  playbook: Playbook;
  /** Called with filled param values when the user confirms. */
  onConfirm: (params: Record<string, string>) => void;
}

type ParamDef = { type?: string; required?: boolean; description?: string };

/**
 * Dynamic form rendered from a playbook's `parameters` schema.
 *
 * - Required params prevent the submit button from being enabled until filled
 * - Calls `onConfirm` with collected param values on submit
 * - Gated on `NEXT_PUBLIC_OBT_CONSOLE_V2 === '1'`
 */
export function PlaybookParamForm({ playbook, onConfirm }: PlaybookParamFormProps) {
  const params = playbook.parameters ?? {};
  const paramEntries = Object.entries(params) as Array<[string, ParamDef]>;

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(paramEntries.map(([key]) => [key, ""])),
  );

  function isValid(): boolean {
    return paramEntries.every(([key, def]) => {
      if (def.required) return values[key]?.trim() !== "";
      return true;
    });
  }

  function handleSubmit() {
    if (!isValid()) return;
    onConfirm(values);
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">{playbook.name} — Parameters</h3>
        {playbook.description && (
          <p className="mt-0.5 text-xs text-fg/50">{playbook.description}</p>
        )}
      </div>

      <div className="space-y-3">
        {paramEntries.map(([key, def]) => (
          <div key={key} className="space-y-1">
            <label className="block text-xs font-medium text-fg/70" htmlFor={`param-${key}`}>
              {key}
              {def.required && <span className="ml-1 text-destructive">*</span>}
            </label>
            {def.description && (
              <p className="text-[11px] text-fg/40">{def.description}</p>
            )}
            <Input
              id={`param-${key}`}
              type="text"
              value={values[key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder={key}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={!isValid()}
          onClick={handleSubmit}
          aria-label="Confirm"
        >
          Confirm
        </Button>
      </div>
    </div>
  );
}
