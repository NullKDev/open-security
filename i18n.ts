import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

const VALID_LOCALES = ['en', 'es'] as const
type Locale = (typeof VALID_LOCALES)[number]

function resolveLocale(value: string | undefined): Locale {
  return (VALID_LOCALES.includes(value as Locale) ? value : 'en') as Locale
}

export default getRequestConfig(async ({ requestLocale }) => {
  // requestLocale comes from the [locale] segment when using i18n routing.
  // For cookie-based (no-segment) routing, it may be undefined — fall back to
  // the obt-locale cookie.
  const segmentLocale = await requestLocale
  let locale: Locale

  if (segmentLocale) {
    locale = resolveLocale(segmentLocale)
  } else {
    const cookieStore = await cookies()
    const cookieLocale = cookieStore.get('obt-locale')?.value
    locale = resolveLocale(cookieLocale)
  }

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
