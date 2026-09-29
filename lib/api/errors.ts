import { NextResponse } from 'next/server'
import type { ApiResponse } from './envelope'

export type ErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL' | 'NOT_IMPLEMENTED'

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
}

export function fail(code: ErrorCode, message: string): NextResponse<ApiResponse<null>> {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status: STATUS[code] }
  )
}
