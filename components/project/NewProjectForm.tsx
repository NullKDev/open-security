"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SourceInput } from "@/components/source/SourceInput";
import type { SourceType, SourceData } from "@/lib/types/source";

export interface NewProjectData {
  name: string;
  sourceKind: SourceType;
  sourceRef: string;
}

interface Props {
  onSubmit: (data: NewProjectData) => void;
  loading?: boolean;
}

export function NewProjectForm({ onSubmit, loading = false }: Props) {
  const [name, setName] = useState("");
  const [sourceData, setSourceData] = useState<SourceData | undefined>();
  const [isSourceValid, setIsSourceValid] = useState(false);

  const handleSourceChange = useCallback((data: SourceData) => {
    setSourceData(data);
  }, []);

  const handleValidationChange = useCallback((valid: boolean) => {
    setIsSourceValid(valid);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sourceData?.sourceRef.trim()) return;
    onSubmit({
      name: name.trim(),
      sourceKind: sourceData.sourceType,
      sourceRef: sourceData.sourceRef,
    });
  }

  const isValid = name.trim().length > 0 && isSourceValid;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="project-name" className="block text-xs font-medium text-fg/60">
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-project"
          className="w-full h-9 rounded-md border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:ring-2 focus:ring-accent/30"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-fg/60">
          Source
        </span>
        <SourceInput
          value={sourceData}
          onChange={handleSourceChange}
          onValidationChange={handleValidationChange}
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={loading}
        disabled={!isValid}
        className="w-full"
      >
        Create Project
      </Button>
    </form>
  );
}
