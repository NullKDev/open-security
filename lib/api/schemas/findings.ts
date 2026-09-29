import { z } from 'zod'

export const ListFindingsSchema = z.object({
  scanId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: z.string().optional(),
  fpFiltered: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      return v === 'true'
    }),
})

export type ListFindingsInput = z.infer<typeof ListFindingsSchema>

export const PatchFindingSchema = z
  .object({
    falsePositive: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine(
    (v) => v.falsePositive !== undefined || v.tags !== undefined,
    { message: 'At least one field (falsePositive or tags) must be provided' },
  )

export type PatchFindingInput = z.infer<typeof PatchFindingSchema>
