import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { readConfig, writeConfig, getPublicConfig } from '@/lib/config/store'
import { ObtConfig } from '@/lib/config/schema'

export async function GET(): Promise<Response> {
  const config = getPublicConfig()
  return ok(config)
}

export async function PUT(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = ObtConfig.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  writeConfig(parsed.data)

  const config = getPublicConfig()
  return ok(config)
}
