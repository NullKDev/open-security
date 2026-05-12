import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getUserLocale } from "@/lib/i18n/locale";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LocaleSwitcher } from "@/components/settings/LocaleSwitcher";

// ─── Settings nav items ───────────────────────────────────────────────────────

const NAV_ITEM_KEYS = [
  {
    href: "/settings/providers",
    sectionKey: "providers" as const,
    descriptionKey: "providersDescription" as const,
  },
  {
    href: "/settings/repos",
    sectionKey: "repos" as const,
    descriptionKey: "reposDescription" as const,
  },
  {
    href: "/settings/webhook",
    sectionKey: "webhook" as const,
    descriptionKey: "webhookDescription" as const,
  },
  {
    href: "/settings/policies",
    sectionKey: "policies" as const,
    descriptionKey: "policiesDescription" as const,
  },
  {
    href: "/settings/integrations",
    sectionKey: "integrations" as const,
    descriptionKey: "integrationsDescription" as const,
  },
] as const;

// Static descriptions — not in catalog (technical/short, no localization needed)
const NAV_DESCRIPTIONS: Record<string, string> = {
  providers: "Assign LLM providers and models per pipeline stage.",
  repos: "Manage tracked repositories, Watch Mode, and webhooks.",
  webhook: "Connect GitHub webhooks for automatic diff scans on PRs.",
  policies: "Edit YAML suppression rules for this workspace.",
  integrations:
    "Configure Jira, Slack, GitHub Code Scanning, and Socket.dev.",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Settings hub — language switcher + links to sub-sections.
 * Server component: reads locale and translations server-side.
 */
export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const locale = await getUserLocale();

  return (
    <div className="max-w-2xl space-y-8 p-6 lg:p-8">
      <h1 className="text-2xl font-bold tracking-tight text-fg">{t("title")}</h1>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle>{t("language")}</CardTitle>
          <CardDescription>{t("languageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher currentLocale={locale} />
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
            {NAV_ITEM_KEYS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between py-3 group"
              >
                <div>
                  <p className="text-sm font-medium text-fg group-hover:text-accent transition-colors">
                    {t(`sections.${item.sectionKey}`)}
                  </p>
                  <p className="text-xs text-fg/50 mt-0.5">
                    {NAV_DESCRIPTIONS[item.sectionKey]}
                  </p>
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
