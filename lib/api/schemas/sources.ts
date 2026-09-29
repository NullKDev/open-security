import { z } from 'zod'

export const ValidateSourceSchema = z.object({
  sourceType: z.enum(['github', 'gitlab', 'local', 'zip']),
  sourceRef: z.string().min(1),
})

export type ValidateSourceInput = z.infer<typeof ValidateSourceSchema>
