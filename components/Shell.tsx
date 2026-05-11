import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

interface ShellProps {
  children: ReactNode;
}

/**
 * Shell — root layout wrapper.
 *
 * Provides the shadcn SidebarProvider and composes:
 * - AppSidebar (left panel)
 * - SidebarInset (main content area + footer)
 *
 * NOTE: SidebarProvider lives here — do NOT add another one in layout.tsx.
 */
export function Shell({ children }: ShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
        <footer className="border-t border-border px-6 py-3 text-xs text-fg/40 flex items-center justify-between">
          <span>open-security</span>
          <a
            href="https://github.com/open-security/open-security"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-fg/60 transition-colors"
          >
            GitHub
          </a>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
