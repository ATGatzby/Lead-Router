import { requireSession } from "@/lib/session";
import { prisma } from "@lead-routing/db";
import { ArrowRightLeft, Users, GitFork, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

async function getOnboardingProgress(orgId: string) {
  const [org, licensedUsers, teams, activeRules] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { onboardingDone: true, sfdcOrgId: true, hubspotPortalId: true, crmType: true } }),
    prisma.user.count({ where: { orgId, isLicensed: true } }),
    prisma.roundRobinTeam.count({ where: { orgId } }),
    prisma.routingRule.count({ where: { orgId, status: "ACTIVE" } }),
  ]);

  const isHubSpot = org?.crmType === "HUBSPOT";
  return {
    connected: isHubSpot ? org.hubspotPortalId != null : org?.sfdcOrgId != null,
    hasLicensedUsers: licensedUsers > 0,
    hasTeams: teams > 0,
    hasRules: activeRules > 0,
    onboardingDone: org?.onboardingDone ?? false,
    crmLabel: isHubSpot ? "HubSpot" : "Salesforce",
    connectHref: isHubSpot ? "/api/auth/hubspot/login" : "/api/auth/sfdc/login",
  };
}

export default async function DashboardPage() {
  const session = await requireSession();
  const progress = await getOnboardingProgress(session.orgId);

  const steps = [
    {
      label: `Connect ${progress.crmLabel}`,
      done: progress.connected,
      href: progress.connectHref,
    },
    {
      label: "License your first user",
      done: progress.hasLicensedUsers,
      href: "/license-users",
    },
    {
      label: "Create a Round Robin team",
      done: progress.hasTeams,
      href: "/round-robins",
    },
    {
      label: "Create your first routing rule",
      done: progress.hasRules,
      href: "/routing-rules",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome back, {session.userName.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your real-time lead routing dashboard.
        </p>
      </div>

      {!allDone && (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Getting Started</h2>
            <span className="text-sm text-muted-foreground">
              {completedCount} of {steps.length} complete
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>

          <ul className="space-y-2.5">
            {steps.map((step) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition-colors"
                >
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span
                    className={
                      step.done
                        ? "text-sm line-through text-muted-foreground"
                        : "text-sm"
                    }
                  >
                    {step.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            href: "/license-users",
            icon: Users,
            label: "License Users",
            desc: "Manage who receives leads",
          },
          {
            href: "/round-robins",
            icon: GitFork,
            label: "Round Robins",
            desc: "Create distribution teams",
          },
          {
            href: "/routing-rules",
            icon: ArrowRightLeft,
            label: "Routing Rules",
            desc: "Define routing logic",
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-xl border bg-card p-4 hover:bg-accent transition-colors space-y-2"
          >
            <item.icon className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
