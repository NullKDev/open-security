"use client";

import { useTranslations } from "next-intl";
import { setLocale } from "@/lib/i18n/actions";
import type { Locale } from "@/lib/i18n/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LocaleSwitcherProps {
  currentLocale: string;
}

/**
 * Client component that renders a locale selector using shadcn Select.
 * Calls the setLocale server action on change and reloads to apply the
 * new locale cookie.
 */
export function LocaleSwitcher({ currentLocale }: LocaleSwitcherProps) {
  const t = useTranslations("settings");

  function handleChange(locale: string) {
    void setLocale(locale as Locale).then(() => {
      window.location.reload();
    });
  }

  return (
    <Select defaultValue={currentLocale} onValueChange={handleChange}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">{t("languages.en")}</SelectItem>
        <SelectItem value="es">{t("languages.es")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
