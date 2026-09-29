import { z } from 'zod'

export const ScanModeSchema = z.enum(['quick', 'standard', 'intermediate', 'paranoid']).default('standard')
export type ScanMode = z.infer<typeof ScanModeSchema>

export const CreateScanSchema = z.object({
  sourceType: z.enum(['github', 'gitlab', 'local', 'zip']).optional(),
  sourceRef: z.string().min(1).optional(),
  projectName: z.string().optional(),
  prompt: z.string().max(2000).optional(),
  scanMode: ScanModeSchema.optional(),
  parentScanId: z.string().uuid().optional(),
}).refine(
  (d) => d.parentScanId !== undefined || (d.sourceType !== undefined && d.sourceRef !== undefined),
  { message: 'Either parentScanId or (sourceType + sourceRef) must be provided' },
)

export type CreateScanInput = z.infer<typeof CreateScanSchema>

export const ListScansSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListScansInput = z.infer<typeof ListScansSchema>
