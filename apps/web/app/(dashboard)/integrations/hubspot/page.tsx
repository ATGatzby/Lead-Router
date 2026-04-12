"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OrgData {
  hubspotPortalId: string | null;
  hubspotAppId: string | null;
  fieldsSyncedAt: string | null;
  createdAt: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function HubSpotIntegrationPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <HubSpotIntegrationInner />
    </Suspense>
  );
}

function HubSpotIntegrationInner() {
  const [org, setOrg] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);

  // Field sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; counts?: Record<string, number>; total?: number; error?: string } | null>(null);

  // Disconnect state
  const [disconnecting, setDisconnecting] = useState(false);

  // ─── Fetch org data ────────────────────────────────────────────────────────

  const fetchOrg = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/hubspot");
      if (res.ok) {
        const data = await res.json();
        setOrg(data);
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
    if (!confirm("Are you sure you want to disconnect HubSpot? This will remove all OAuth credentials and you'll need to reconnect.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/hubspot/disconnect", { method: "POST" });
      if (res.ok) {
        setOrg(null);
        setSyncResult(null);
      }
    } catch {
      // silently fail
    } finally {
      setDisconnecting(false);
    }
  }, []);

  // ─── Sync fields ───────────────────────────────────────────────────────────

  const handleSyncFields = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/hubspot/fields", { method: "POST" });
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

  const isConnected = !!org?.hubspotPortalId;

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
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-950">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
            <path
              d="M17.83 9.17V6.59c.7-.33 1.17-1.04 1.17-1.84v-.06c0-1.13-.92-2.04-2.05-2.04h-.06c-1.13 0-2.04.92-2.04 2.04v.06c0 .8.47 1.51 1.17 1.84v2.58a5.24 5.24 0 0 0-2.29 1.18l-6.07-4.73a2.34 2.34 0 0 0 .07-.54c0-1.3-1.05-2.35-2.35-2.35S3.03 3.98 3.03 5.28s1.05 2.35 2.35 2.35c.46 0 .88-.14 1.24-.37l5.97 4.65a5.26 5.26 0 0 0-.63 2.49c0 2.91 2.36 5.27 5.27 5.27s5.27-2.36 5.27-5.27-2.36-5.27-5.27-5.27c-.76 0-1.48.16-2.13.45zm-.6 7.87a2.64 2.64 0 1 1 0-5.27 2.64 2.64 0 0 1 0 5.27z"
              fill="#FF7A59"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">HubSpot</h1>
          <p className="text-sm text-muted-foreground">Manage your HubSpot integration</p>
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
              <span className="text-muted-foreground">Portal ID</span>
              <span className="font-mono text-xs">{org?.hubspotPortalId}</span>
            </div>
            {org?.hubspotPortalId && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">HubSpot</span>
                <a
                  href={`https://app.hubspot.com/contacts/${org.hubspotPortalId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-orange-600 dark:text-orange-400 hover:underline"
                >
                  Open Portal
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/auth/hubspot/login">
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

      {/* Section 2: Field Sync */}
      <section className="rounded-xl border border-border bg-white dark:bg-[#12121a] shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Field Sync</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Sync field metadata from HubSpot so you can use them in routing rules.
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
