"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { NewProjectForm, type NewProjectData } from "@/components/project/NewProjectForm";
import { ScanConfig, type ScanConfigData } from "@/components/project/ScanConfig";

type FlowState = "idle" | "new_project" | "config" | "scanning";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

const CONSOLE_V2 = process.env.NEXT_PUBLIC_OBT_CONSOLE_V2 === "1";

const BASE_NAV_ITEMS: NavItem[] = [
  {
    href: "/queue",
    label: "Queue",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
  {
    href: "/repos",
    label: "Repos",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3h18v18H3z" rx="2"/>
        <path d="M9 3v18"/>
        <path d="M3 9h18"/>
      </svg>
    ),
  },
  {
    href: "/findings",
    label: "Findings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
  {
    href: "/posture",
    label: "Posture",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    href: "/",
    label: "Projects",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    href: "/config",
    label: "Settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
  {
    href: "/settings/webhook",
    label: "Webhook",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    ),
  },
];

/** Hunt nav item — only included when v0.3 console UI is enabled. */
const HUNT_NAV_ITEM: NavItem = {
  href: "/hunt",
  label: "Hunt",
  icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.35-4.35"/>
      <path d="M11 8v6M8 11h6"/>
    </svg>
  ),
};

const NAV_ITEMS: NavItem[] = CONSOLE_V2
  ? [...BASE_NAV_ITEMS, HUNT_NAV_ITEM]
  : BASE_NAV_ITEMS;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [flow, setFlow] = useState<FlowState>("idle");
  const [projectName, setProjectName] = useState("");
  const [modelsConfig, setModelsConfig] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function handleCreateProject(data: NewProjectData) {
    setCreating(true);
    setProjectName(data.name);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: data.sourceKind,
          sourceRef: data.sourceRef,
          projectName: data.name,
        }),
      });
      if (!res.ok) throw new Error("Failed to create project");
      const body = await res.json();
      setFlow("config");
      // Store scanId + modelsConfig from the response
      sessionStorage.setItem("activeScanId", body.data.id);
      if (body.data.project?.modelsConfig) {
        setModelsConfig(body.data.project.modelsConfig);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleStartScan(data: ScanConfigData) {
    setScanning(true);
    const scanId = sessionStorage.getItem("activeScanId");
    if (scanId) {
      setFlow("scanning");
      router.push(`/scans/${scanId}`);
    }
  }

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-full w-[220px] flex-col border-r border-border bg-surface">
      {/* Brand */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <span className="text-sm font-semibold tracking-tight text-fg">open-security</span>
      </div>

      {/* Navigation */}
      <nav className="space-y-0.5 px-2 py-3" aria-label="Sidebar navigation">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-[120ms] ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-fg/50 hover:text-fg hover:bg-surface-hover"
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Project flow section */}
      {pathname === "/" && (
        <div className="flex-1 overflow-y-auto border-t border-border px-3 py-3">
          {flow === "idle" && (
            <button
              onClick={() => setFlow("new_project")}
              className="flex w-full items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors duration-[120ms] hover:brightness-110"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Project
            </button>
          )}

          {flow === "new_project" && (
            <NewProjectForm onSubmit={handleCreateProject} loading={creating} />
          )}

          {flow === "config" && (
            <ScanConfig
              projectName={projectName}
              modelsConfig={modelsConfig}
              onSubmit={handleStartScan}
              loading={scanning}
            />
          )}

          {flow === "scanning" && (
            <div className="space-y-3">
              <p className="text-xs text-fg/50">
                Scanning <span className="font-medium text-fg">{projectName}</span>
              </p>
              <div className="flex items-center gap-2 text-sm text-accent">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Analyzing...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Theme toggle */}
      <div className="border-t border-border px-3 py-2">
        <ThemeToggle />
      </div>
    </aside>
  );
}
