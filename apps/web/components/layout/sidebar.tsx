"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  GitFork,
  GitBranch,
  ArrowRightLeft,
  History,
  Settings,
  Zap,
  BarChart3,
  Plug,
  BrainCircuit,
  HeartPulse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { ThemeToggle } from "@/components/theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Setup",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/license-users", label: "License Users", icon: Users },
      { href: "/round-robins", label: "Teams", icon: GitFork },
    ],
  },
  {
    label: "Routing",
    items: [
      {
        href: "/routing-rules",
        label: "Routing Rules",
        icon: ArrowRightLeft,
      },
      { href: "/flow-builder/LEAD", label: "Flow Builder", icon: GitBranch, badge: "New" },
      { href: "/activity", label: "Activity", icon: History },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        href: "/analytics",
        label: "Analytics",
        icon: BarChart3,
        badge: "Pro",
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/ai-assistant", label: "AI Assistant", icon: BrainCircuit, badge: "Pro" },
    ],
  },
  {
    label: "Verify & Debug",
    items: [
      { href: "/trigger-health", label: "Trigger Health", icon: HeartPulse },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col bg-sidebar">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
          LR
        </div>
        <span className="text-sm font-semibold text-sidebar-foreground font-display">Lead Router</span>
        <div className="ml-auto">
          <Zap className="h-3.5 w-3.5 text-sidebar-muted-foreground" />
        </div>
      </div>

      {/* Onboarding checklist */}
      <OnboardingChecklist />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.label}>
            {idx !== 0 && <Separator className="mb-3 bg-sidebar-border" />}
            <p className="px-2 mb-1 text-xs font-medium text-sidebar-muted-foreground uppercase tracking-wider">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? item.badge
                            ? "bg-violet-500/10 text-violet-300 font-medium"
                            : "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                      {item.badge && (
                        <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide rounded bg-gradient-to-r from-violet-600 to-purple-500 px-1.5 py-0.5 text-white">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-sidebar-border px-3 py-2">
        <ThemeToggle />
      </div>
    </aside>
  );
}
