import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Fira_Code } from "next/font/google";
import Script from "next/script";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getUserLocale } from "@/lib/i18n/locale";
import "./globals.css";
import { Shell } from "@/components/Shell";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "open-security — Blue Team Workbench",
  description:
    "Open-source, local-first Blue Team security workbench. Scan your code, find vulnerabilities, and triage findings — all from your machine. No login, no telemetry, no daemon.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("obt-theme")?.value || "light";
  const locale = await getUserLocale();
  const messages = (await import(`../messages/${locale}.json`)).default;

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${plusJakartaSans.variable} ${firaCode.variable} h-full antialiased${theme === "dark" ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <head />
      <body className="h-full bg-bg text-fg">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('obt-theme');var d=document.documentElement;if(t){d.setAttribute('data-theme',t);t==='dark'?d.classList.add('dark'):d.classList.remove('dark');}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){d.setAttribute('data-theme','dark');d.classList.add('dark');}}catch(e){}})();`,
          }}
        />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Shell>{children}</Shell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
