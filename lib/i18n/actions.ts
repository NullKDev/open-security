'use server'
import { cookies } from 'next/headers'
import { VALID_LOCALES, type Locale } from './locale'

/**
 * Server Action: persist the user's locale preference in the obt-locale cookie.
 * Rejects silently if the locale is not in VALID_LOCALES.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!VALID_LOCALES.includes(locale)) return

  const cookieStore = await cookies()
  cookieStore.set('obt-locale', locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax',
  })
}
