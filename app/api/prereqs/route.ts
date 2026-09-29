import { ok } from '@/lib/api/envelope'
import { checkPrereqs } from '@/lib/config/prereqs'

export async function GET(): Promise<Response> {
  const results = checkPrereqs()
  const allPresent = results.every((r) => r.present)
  return ok({ prereqs: results, allPresent })
}
