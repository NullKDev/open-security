"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setLocale } from "@/lib/i18n/actions";
import type { Locale } from "@/lib/i18n/locale";

// ─── Locale Switcher ──────────────────────────────────────────────────────────

/**
 * Client component that renders a locale selector (EN / ES).
 * Calls the setLocale server action on change and refreshes the page.
 */
function LocaleSwitcher() {
  const [isPending, startTransition] = useTransition();

  function handleChange(locale: Locale) {
    startTransition(async () => {
      await setLocale(locale);
      // Full page reload so next-intl picks up the new cookie
      window.location.reload();
    });
  }

  return (
    <div className="flex gap-2">
      {(["en", "es"] as const).map((locale) => (
        <button
          key={locale}
          type="button"
          disabled={isPending}
          onClick={() => handleChange(locale)}
          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg/70 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {locale === "en" ? "English" : "Español"}
        </button>
      ))}
    </div>
  );
}

// ─── Settings nav items ───────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    href: "/settings/providers",
    label: "Providers",
    description: "Assign LLM providers and models per pipeline stage.",
  },
  {
    href: "/settings/repos",
    label: "Repositories",
    description: "Manage tracked repositories, Watch Mode, and webhooks.",
  },
  {
    href: "/settings/webhook",
    label: "Webhook",
    description: "Connect GitHub webhooks for automatic diff scans on PRs.",
  },
  {
    href: "/settings/policies",
    label: "Policies",
    description: "Edit YAML suppression rules for this workspace.",
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    description: "Configure Jira, Slack, GitHub Code Scanning, and Socket.dev.",
  },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Settings hub — language switcher + links to sub-sections.
 */
export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-8 p-6 lg:p-8">
      <h1 className="text-2xl font-bold tracking-tight text-fg">Settings</h1>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle>Language</CardTitle>
          <CardDescription>
            Choose the display language for the interface.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher />
        </CardContent>
      </Card>

      {/* Configuration links */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Manage providers, repositories, webhooks, policies, and external
            integrations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <nav className="divide-y divide-border">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between py-3 group"
              >
                <div>
                  <p className="text-sm font-medium text-fg group-hover:text-accent transition-colors">
                    {item.label}
                  </p>
                  <p className="text-xs text-fg/50 mt-0.5">{item.description}</p>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-fg/30 group-hover:text-accent transition-colors shrink-0"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ))}
          </nav>
        </CardContent>
      </Card>
    </div>
  );
}
