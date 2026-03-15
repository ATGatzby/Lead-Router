"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  Package,
} from "lucide-react";
import Link from "next/link";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OrgData {
  sfdcOrgId: string | null;
  sfdcInstanceUrl: string | null;
  packageDeployedAt: string | null;
  packageVersion: string | null;
  objectConfig: Record<string, { enabled: boolean }> | null;
  fieldsSyncedAt: string | null;
  createdAt: string;
}

interface DeployResult {
  success: boolean;
  componentCount?: number;
  error?: string;
}

const SFDC_OBJECTS = [
  {
    key: "Lead",
    label: "Lead",
    color: "bg-purple-500",
    description: "Inbound leads from web forms, marketing, etc.",
  },
  {
    key: "Contact",
    label: "Contact",
    color: "bg-blue-500",
    description: "Contacts associated with accounts.",
  },
  {
    key: "Account",
    label: "Account",
    color: "bg-emerald-500",
    description: "Company / organization records.",
  },
  {
    key: "Opportunity",
    label: "Opportunity",
    color: "bg-amber-500",
    description: "Sales opportunities and deals.",
  },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function SalesforceIntegrationPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <SalesforceIntegrationInner />
    </Suspense>
  );
}

function SalesforceIntegrationInner() {
  const searchParams = useSearchParams();
  const autoConnect = searchParams.get("connected") === "1";

  const [org, setOrg] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);

  // Deploy state
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);

  // Object config state
  const [objectConfig, setObjectConfig] = useState<Record<string, { enabled: boolean }>>({
    Lead: { enabled: true },
    Contact: { enabled: true },
    Account: { enabled: false },
    Opportunity: { enabled: false },
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // Field sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; counts?: Record<string, number>; total?: number; error?: string } | null>(null);

  // Disconnect state
  const [disconnecting, setDisconnecting] = useState(false);

  // ─── Fetch org data ────────────────────────────────────────────────────────

  const fetchOrg = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/salesforce");
      if (res.ok) {
        const data = await res.json();
        setOrg(data);
        if (data.objectConfig) {
          setObjectConfig(data.objectConfig);
        }
      }
    } catch {
      // silently fail — page will show disconnected state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  // ─── Disconnect ────────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(async () => {
    if (!confirm("Are you sure you want to disconnect Salesforce? This will remove all OAuth credentials and you'll need to reconnect.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/salesforce/disconnect", { method: "POST" });
      if (res.ok) {
        setOrg(null);
        setDeployResult(null);
        setSyncResult(null);
      }
    } catch {
      // silently fail
    } finally {
      setDisconnecting(false);
    }
  }, []);

  // ─── Auto-deploy on connect ────────────────────────────────────────────────

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    setDeployResult(null);
    try {
      const res = await fetch("/api/integrations/salesforce/deploy", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setDeployResult({ success: true, componentCount: data.componentsDeployed });
        fetchOrg(); // refresh org data to show updated deploy info
      } else {
        const errorMsg = data.details ? `${data.error}: ${data.details}` : (data.error || "Deploy failed");
        setDeployResult({ success: false, error: errorMsg });
      }
    } catch (err) {
      setDeployResult({ success: false, error: "Network error — please try again" });
    } finally {
      setDeploying(false);
    }
  }, [fetchOrg]);

  useEffect(() => {
    if (autoConnect && !deploying && !deployResult) {
      handleDeploy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  // ─── Save object config ────────────────────────────────────────────────────

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setConfigSaved(false);
    try {
      const res = await fetch("/api/integrations/salesforce/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectConfig }),
      });
      if (res.ok) {
        setConfigSaved(true);
        setTimeout(() => setConfigSaved(false), 3000);
      }
    } catch {
      // ignore
    } finally {
      setSavingConfig(false);
    }
  };

  // ─── Sync fields ───────────────────────────────────────────────────────────

  const handleSyncFields = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/salesforce/fields", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult({ success: true, counts: data.counts, total: data.total });
        fetchOrg();
      } else {
        setSyncResult({ success: false, error: data.error });
      }
    } catch {
      setSyncResult({ success: false });
    } finally {
      setSyncing(false);
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const isConnected = !!org?.sfdcOrgId;
  const isDeployed = !!org?.packageDeployedAt;

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href="/integrations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
            <path
              d="M10.01 4.18c.9-.96 2.15-1.56 3.54-1.56 1.72 0 3.23.9 4.09 2.25a5.46 5.46 0 0 1 2.16-.45C22.16 4.42 24 6.29 24 8.6c0 .34-.04.68-.12 1a3.75 3.75 0 0 1 .12.94c0 2.28-1.85 4.13-4.13 4.13-.37 0-.72-.05-1.06-.14a4.52 4.52 0 0 1-3.96 2.35c-.6 0-1.17-.12-1.69-.33a4.84 4.84 0 0 1-4.34 2.7 4.84 4.84 0 0 1-4.56-3.23A4.16 4.16 0 0 1 0 12.04c0-1.56.86-2.92 2.14-3.63a4.24 4.24 0 0 1-.18-1.23c0-2.33 1.89-4.22 4.22-4.22 1.33 0 2.52.62 3.29 1.58l.54-.36z"
              fill="#00A1E0"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Salesforce</h1>
          <p className="text-sm text-muted-foreground">Manage your Salesforce integration</p>
        </div>
      </div>

      {/* Section 1: Connection */}
      <section className="rounded-xl border border-border bg-white dark:bg-[#12121a] shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Connection</h2>
          {isConnected ? (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
              <span className="text-sm font-medium text-muted-foreground">Not Connected</span>
            </div>
          )}
        </div>

        {isConnected && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Org ID</span>
              <span className="font-mono text-xs">{org?.sfdcOrgId}</span>
            </div>
            {org?.sfdcInstanceUrl && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Instance URL</span>
                <a
                  href={org.sfdcInstanceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {org.sfdcInstanceUrl.replace("https://", "")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/auth/sfdc/login">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Reconnect
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Disconnect
          </Button>
        </div>
      </section>

      {/* Section 2: Package Deploy */}
      <section className="rounded-xl border border-border bg-white dark:bg-[#12121a] shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Package Deploy</h2>
          </div>
          {isDeployed && (
            <Badge className="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900">
              Deployed
            </Badge>
          )}
        </div>

        {isDeployed && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Deployed</span>
              <span>{formatDate(org?.packageDeployedAt ?? null)}</span>
            </div>
            {org?.packageVersion && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono text-xs">{org.packageVersion}</span>
              </div>
            )}
          </div>
        )}

        {!isDeployed && !deploying && !deployResult && (
          <p className="text-sm text-muted-foreground">
            Deploy the Apex package to your Salesforce org to enable real-time routing triggers.
          </p>
        )}

        {/* Deploy progress / result */}
        {deploying && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-4">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Deploying package...</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">This may take up to 2 minutes.</p>
            </div>
          </div>
        )}

        {deployResult?.success && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Package deployed successfully</p>
              {deployResult.componentCount && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {deployResult.componentCount} components deployed
                </p>
              )}
            </div>
          </div>
        )}

        {deployResult && !deployResult.success && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">Deploy failed</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{deployResult.error}</p>
            </div>
          </div>
        )}

        <Button
          size="sm"
          onClick={handleDeploy}
          disabled={deploying || !isConnected}
        >
          {deploying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              Deploying...
            </>
          ) : isDeployed ? (
            "Redeploy Package"
          ) : (
            "Deploy Package"
          )}
        </Button>
      </section>

      {/* Section 3: Object Configuration */}
      <section className="rounded-xl border border-border bg-white dark:bg-[#12121a] shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Object Configuration</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which Salesforce objects to include in routing rules.
          </p>
        </div>

        <div className="space-y-3">
          {SFDC_OBJECTS.map((obj) => (
            <div
              key={obj.key}
              className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-md ${obj.color} text-white text-sm font-bold`}
                >
                  {obj.label[0]}
                </div>
                <div>
                  <p className="text-sm font-medium">{obj.label}</p>
                  <p className="text-xs text-muted-foreground">{obj.description}</p>
                </div>
              </div>
              <Switch
                checked={objectConfig[obj.key]?.enabled ?? false}
                onCheckedChange={(checked: boolean) =>
                  setObjectConfig((prev) => ({
                    ...prev,
                    [obj.key]: { enabled: checked },
                  }))
                }
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig}>
            {savingConfig ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                Saving...
              </>
            ) : (
              "Save Configuration"
            )}
          </Button>
          {configSaved && (
            <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
        </div>
      </section>

      {/* Section 4: Field Sync */}
      <section className="rounded-xl border border-border bg-white dark:bg-[#12121a] shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Field Sync</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Sync field metadata from Salesforce so you can use them in routing rules.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last synced</span>
            <span>{org?.fieldsSyncedAt ? formatDate(org.fieldsSyncedAt) : "Never synced"}</span>
          </div>
        </div>

        {syncResult?.success && syncResult.counts && (
          <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 p-4 space-y-2">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              Synced {syncResult.total ?? Object.values(syncResult.counts).reduce((a, b) => a + b, 0)} fields
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(syncResult.counts).map(([obj, count]) => (
                <div key={obj} className="flex justify-between">
                  <span className="text-muted-foreground">{obj}</span>
                  <span className="font-medium">{count} fields</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {syncResult && !syncResult.success && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              Field sync failed{syncResult.error ? `: ${syncResult.error}` : ""}
            </p>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncFields}
          disabled={syncing || !isConnected}
        >
          {syncing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Sync Fields
            </>
          )}
        </Button>
      </section>
    </div>
  );
}
