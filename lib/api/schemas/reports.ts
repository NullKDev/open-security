import { z } from 'zod'

export const ReportFormatSchema = z.enum(['md', 'json', 'sarif', 'csv'])
export type ReportFormat = z.infer<typeof ReportFormatSchema>
