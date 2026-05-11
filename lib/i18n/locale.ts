import { cookies } from 'next/headers'

export const VALID_LOCALES = ['en', 'es'] as const
export type Locale = (typeof VALID_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

/**
 * Returns the active locale for the current request, resolved from the
 * obt-locale cookie. Falls back to DEFAULT_LOCALE when the cookie is absent
 * or contains an unrecognised value.
 */
export async function getUserLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const value = cookieStore.get('obt-locale')?.value
  return (VALID_LOCALES.includes(value as Locale) ? value : DEFAULT_LOCALE) as Locale
}
