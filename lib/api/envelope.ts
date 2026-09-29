import { NextResponse } from 'next/server'

export interface ApiMeta {
  total?: number
  cursor?: string
}

export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: { code: string; message: string } | null
  meta?: ApiMeta
}

export function ok<T>(data: T, meta?: ApiMeta): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, error: null, meta }, { status: 200 })
}

export function created<T>(data: T): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, error: null }, { status: 201 })
}

export function paginated<T>(data: T[], meta: ApiMeta): NextResponse<ApiResponse<T[]>> {
  return NextResponse.json({ success: true, data, error: null, meta }, { status: 200 })
}
