import { prisma } from "@lead-routing/db";
import { requireSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function IntegrationsPage() {
  const session = await requireSession();
  const org = await prisma.organization.findUnique({
    where: { id: session.orgId },
    select: { sfdcOrgId: true, hubspotPortalId: true, crmType: true },
  });

  const crmType = org?.crmType ?? process.env.CRM_TYPE?.toUpperCase() ?? null;
  const sfConnected = !!org?.sfdcOrgId;
  const hsConnected = !!org?.hubspotPortalId;
  const showSalesforce = !crmType || crmType === "SALESFORCE";
  const showHubSpot = !crmType || crmType === "HUBSPOT";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your CRM and other tools to power lead routing.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Salesforce */}
        {showSalesforce && (
          <div className="rounded-xl border border-border bg-white dark:bg-card shadow-sm hover:shadow-md transition-shadow">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                    <path
                      d="M10.01 4.18c.9-.96 2.15-1.56 3.54-1.56 1.72 0 3.23.9 4.09 2.25a5.46 5.46 0 0 1 2.16-.45C22.16 4.42 24 6.29 24 8.6c0 .34-.04.68-.12 1a3.75 3.75 0 0 1 .12.94c0 2.28-1.85 4.13-4.13 4.13-.37 0-.72-.05-1.06-.14a4.52 4.52 0 0 1-3.96 2.35c-.6 0-1.17-.12-1.69-.33a4.84 4.84 0 0 1-4.34 2.7 4.84 4.84 0 0 1-4.56-3.23A4.16 4.16 0 0 1 0 12.04c0-1.56.86-2.92 2.14-3.63a4.24 4.24 0 0 1-.18-1.23c0-2.33 1.89-4.22 4.22-4.22 1.33 0 2.52.62 3.29 1.58l.54-.36z"
                      fill="#00A1E0"
                    />
                  </svg>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                    CRM
                  </Badge>
                  {sfConnected ? (
                    <Badge className="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900">
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      Not Connected
                    </Badge>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-base">Salesforce</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Route leads, contacts, and accounts from Salesforce.
                </p>
              </div>

              <div>
                {sfConnected ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/integrations/salesforce">
                      Configure
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <a href="/api/auth/sfdc/login">Connect</a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* HubSpot */}
        {showHubSpot && (
          <div className="rounded-xl border border-border bg-white dark:bg-card shadow-sm hover:shadow-md transition-shadow">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-950">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                    <path
                      d="M17.83 9.17V6.59c.7-.33 1.17-1.04 1.17-1.84v-.06c0-1.13-.92-2.04-2.05-2.04h-.06c-1.13 0-2.04.92-2.04 2.04v.06c0 .8.47 1.51 1.17 1.84v2.58a5.24 5.24 0 0 0-2.29 1.18l-6.07-4.73a2.34 2.34 0 0 0 .07-.54c0-1.3-1.05-2.35-2.35-2.35S3.03 3.98 3.03 5.28s1.05 2.35 2.35 2.35c.46 0 .88-.14 1.24-.37l5.97 4.65a5.26 5.26 0 0 0-.63 2.49c0 2.91 2.36 5.27 5.27 5.27s5.27-2.36 5.27-5.27-2.36-5.27-5.27-5.27c-.76 0-1.48.16-2.13.45zm-.6 7.87a2.64 2.64 0 1 1 0-5.27 2.64 2.64 0 0 1 0 5.27z"
                      fill="#FF7A59"
                    />
                  </svg>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                    CRM
                  </Badge>
                  {hsConnected ? (
                    <Badge className="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900">
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      Not Connected
                    </Badge>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-base">HubSpot</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Route contacts, companies, and deals from HubSpot.
                </p>
              </div>

              <div>
                {hsConnected ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/integrations">
                      Configure
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <a href="/api/auth/hubspot/login">Connect</a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
