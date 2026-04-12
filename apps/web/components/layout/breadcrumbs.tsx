"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

const SEGMENT_LABELS: Record<string, string> = {
  "routing-rules": "Route Workflows",
  "round-robins": "Teams",
  "license-users": "Users",
  integrations: "Integrations",
  salesforce: "Salesforce",
  hubspot: "HubSpot",
  activity: "Activity",
  audit: "Audit Log",
  journey: "Journey",
  failed: "Failed",
  stats: "Stats",
  analytics: "Analytics",
  rules: "Rules",
  teams: "Teams",
  conversions: "Conversions",
  settings: "Settings",
  ai: "AI",
  prompts: "Prompts",
  performance: "Performance",
  "api-tokens": "API Tokens",
  license: "License",
  notifications: "Notifications",
  "mcp-server": "MCP Server",
  "ai-assistant": "AI Assistant",
  "trigger-health": "Trigger Health",
  "sla-policies": "SLA Policies",
  new: "New",
  edit: "Edit",
  flow: "Flow Builder",
  migration: "Migration",
  leandata: "LeanData Import",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(segment: string): boolean {
  return UUID_PATTERN.test(segment);
}

export function Breadcrumbs() {
  const pathname = usePathname();

  if (!pathname || pathname === "/") return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // Build crumbs, skipping UUID segments
  const crumbs: { label: string; href: string }[] = [];
  let hrefAccumulator = "";

  for (const segment of segments) {
    hrefAccumulator += `/${segment}`;

    if (isUuid(segment)) {
      // Skip UUIDs — don't render them but keep the href accumulating
      continue;
    }

    const label = SEGMENT_LABELS[segment] ?? segment;
    crumbs.push({ label, href: hrefAccumulator });
  }

  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 border-b border-border/50 px-6 py-1.5"
      style={{ minHeight: 32 }}
    >
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;

        return (
          <span key={crumb.href} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
            )}
            {isLast ? (
              <span className="text-xs font-semibold text-foreground">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
