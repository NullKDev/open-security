/**
 * Shared types for source input components.
 * Used by SourceInput, NewProjectForm, /scans/new, and API schemas.
 */

/** Supported source types — mirrors zod schema in lib/api/schemas/scans.ts */
export type SourceType = "github" | "gitlab" | "local" | "zip";

/** Data payload emitted on source change or form submit */
export interface SourceData {
  sourceType: SourceType;
  sourceRef: string;
  /** Optional password for encrypted ZIP files */
  password?: string;
}
