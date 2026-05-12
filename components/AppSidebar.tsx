"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckListIcon,
  FolderOpenIcon,
  Analytics01Icon,
  File01Icon,
  Settings01Icon,
  Add01Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { NewScanModal } from "@/components/modals/NewScanModal";

/** Package version injected at build time by Next.js via NEXT_PUBLIC_ convention. */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

interface NavItem {
  href: string;
  labelKey: string;
  /** HugeIcons icon object */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/queue", labelKey: "queue", icon: CheckListIcon },
  { href: "/projects", labelKey: "projects", icon: FolderOpenIcon },
  { href: "/posture", labelKey: "posture", icon: Analytics01Icon },
  { href: "/reports", labelKey: "reports", icon: File01Icon },
  { href: "/settings", labelKey: "settings", icon: Settings01Icon },
];

/**
 * AppSidebar — primary navigation sidebar built with shadcn sidebar primitives.
 *
 * - Uses SidebarProvider from Shell.tsx (do not nest another provider here).
 * - Opens NewScanModal via the "New Scan" button in the header.
 * - Active route detection via usePathname().
 */
export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [scanModalOpen, setScanModalOpen] = useState(false);

  return (
    <>
      <Sidebar collapsible="icon">
        {/* ── Header: logo + New Scan ───────────────────────────────── */}
        <SidebarHeader>
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent">
              <HugeiconsIcon icon={Shield01Icon} size={14} color="white" strokeWidth={2.5} />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              open-security
            </span>
          </div>

          <button
            type="button"
            onClick={() => setScanModalOpen(true)}
            className="flex w-full items-center gap-2 rounded-[calc(var(--radius-sm)+2px)] bg-accent px-2 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            aria-label={t("newScan")}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
            <span className="group-data-[collapsible=icon]:hidden">{t("newScan")}</span>
          </button>
        </SidebarHeader>

        {/* ── Content: nav items ────────────────────────────────────── */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={t(item.labelKey as Parameters<typeof t>[0])}
                        aria-current={isActive ? "page" : undefined}
                        className={
                          isActive
                            ? "bg-accent/10 text-accent"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                        }
                      >
                        <Link href={item.href}>
                          <HugeiconsIcon icon={item.icon} size={16} strokeWidth={2} />
                          <span>{t(item.labelKey as Parameters<typeof t>[0])}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* ── Footer: theme toggle + version + GitHub ──────────────── */}
        <SidebarFooter>
          <div className="flex items-center justify-between px-1">
            <ThemeToggle />
            <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
              <span className="text-[10px] text-sidebar-foreground/30">
                v{APP_VERSION}
              </span>
              <a
                href="https://github.com/open-security/open-security"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-sidebar-foreground/30 hover:text-sidebar-foreground/60 transition-colors"
                aria-label="GitHub"
              >
                GitHub
              </a>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      <NewScanModal open={scanModalOpen} onOpenChange={setScanModalOpen} />
    </>
  );
}
