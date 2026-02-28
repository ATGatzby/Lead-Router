"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface OrgDetail {
  id: string;
  sfdcOrgId: string;
  plan: "FREE" | "PAID";
  isActive: boolean;
  seatsPurchased: number;
  seatsUsed: number;
  routingQuotaUsed: number;
  routingQuotaLimit: number;
  quotaPercent: number;
  quotaResetAt: string;
  createdAt: string;
  billingInfo: {
    entityName: string | null;
    invoiceEmail: string | null;
  } | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-5 space-y-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value ?? "—"}</span>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: "destructive" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg border shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors ${
              confirmVariant === "destructive"
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-primary hover:bg-primary/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Editable state
  const [selectedPlan, setSelectedPlan] = useState<"FREE" | "PAID">("FREE");
  const [seatsInput, setSeatsInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Confirm dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: "activate" | "deactivate" | "soft_reset" | "hard_reset";
  }>({ open: false, type: "activate" });

  useEffect(() => {
    fetchOrg();
  }, [id]);

  async function fetchOrg() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orgs/${id}`);
      if (!res.ok) throw new Error("Failed to load org");
      const data = await res.json();
      setOrg(data.org);
      setSelectedPlan(data.org.plan);
      setSeatsInput(String(data.org.seatsPurchased));
    } catch {
      setError("Failed to load organization");
    } finally {
      setLoading(false);
    }
  }

  async function apiAction(url: string, method: string, body?: object) {
    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Action failed");
      }
      await fetchOrg();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSaving(false);
    }
  }

  function handleConfirm() {
    const { type } = confirmDialog;
    setConfirmDialog({ open: false, type });
    if (type === "activate") apiAction(`/api/admin/orgs/${id}/activate`, "POST");
    if (type === "deactivate") apiAction(`/api/admin/orgs/${id}/deactivate`, "POST");
    if (type === "soft_reset") apiAction(`/api/admin/orgs/${id}/reset`, "POST", { mode: "soft" });
    if (type === "hard_reset") apiAction(`/api/admin/orgs/${id}/reset`, "POST", { mode: "hard" });
  }

  const dialogConfig = {
    activate: {
      title: "Activate Organization",
      description: "This will re-activate the organization and allow routing webhooks to be processed.",
      confirmLabel: "Activate",
      confirmVariant: "default" as const,
    },
    deactivate: {
      title: "Suspend Organization",
      description: "This will immediately suspend the organization. All routing requests will be rejected with 403.",
      confirmLabel: "Suspend",
      confirmVariant: "destructive" as const,
    },
    soft_reset: {
      title: "Soft Reset",
      description: "This will delete all routing logs and reset the monthly quota counter. Rules, users, and teams are preserved.",
      confirmLabel: "Reset Logs",
      confirmVariant: "destructive" as const,
    },
    hard_reset: {
      title: "Hard Reset — Irreversible",
      description: "This will permanently delete ALL data for this org: rules, users, teams, logs, queues, and field schemas. Billing info is preserved. The org will need to re-onboard from scratch.",
      confirmLabel: "Delete Everything",
      confirmVariant: "destructive" as const,
    },
  };

  const current = dialogConfig[confirmDialog.type];

  if (loading) {
    return <div className="text-sm text-muted-foreground p-8">Loading…</div>;
  }
  if (!org) {
    return (
      <div className="p-8 space-y-2">
        <p className="text-sm text-destructive">{error || "Organization not found."}</p>
        <Link href="/admin/orgs" className="text-sm text-primary hover:underline">
          ← Back to orgs
        </Link>
      </div>
    );
  }

  const quotaCapped = Math.min(org.quotaPercent, 100);
  const quotaColor =
    quotaCapped >= 100 ? "bg-destructive" : quotaCapped >= 80 ? "bg-amber-500" : "bg-primary";

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        title={current.title}
        description={current.description}
        confirmLabel={current.confirmLabel}
        confirmVariant={current.confirmVariant}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmDialog((d) => ({ ...d, open: false }))}
      />

      <div className="max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/admin/orgs" className="hover:text-foreground">
            Organizations
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">
            {org.billingInfo?.entityName ?? org.sfdcOrgId}
          </span>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}

        {/* Org Info */}
        <Section title="Organization Info">
          <Field label="SFDC Org ID" value={<span className="font-mono text-xs">{org.sfdcOrgId}</span>} />
          <Field label="Entity Name" value={org.billingInfo?.entityName} />
          <Field label="Invoice Email" value={org.billingInfo?.invoiceEmail} />
          <Field label="Created" value={new Date(org.createdAt).toLocaleString()} />
        </Section>

        {/* Plan & Seats */}
        <Section title="Plan & Seats">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground w-24">Plan</label>
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value as "FREE" | "PAID")}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="FREE">FREE — 5 seats, 100 leads/mo</option>
                <option value="PAID">PAID — 20 seats, 1,000 leads/mo</option>
              </select>
              <button
                onClick={() => apiAction(`/api/admin/orgs/${id}/plan`, "PUT", { plan: selectedPlan })}
                disabled={saving || selectedPlan === org.plan}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                Save Plan
              </button>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground w-24">Seats</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={seatsInput}
                onChange={(e) => setSeatsInput(e.target.value)}
                className="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={() =>
                  apiAction(`/api/admin/orgs/${id}/seats`, "PUT", {
                    seatsPurchased: Number(seatsInput),
                  })
                }
                disabled={saving || Number(seatsInput) === org.seatsPurchased}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                Save Seats
              </button>
            </div>
            <Field label="Seats Used" value={`${org.seatsUsed} / ${org.seatsPurchased}`} />
          </div>
        </Section>

        {/* Routing Quota */}
        <Section title="Routing Quota">
          <Field
            label="Usage"
            value={`${org.routingQuotaUsed} / ${org.routingQuotaLimit} leads`}
          />
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quotaColor}`}
              style={{ width: `${quotaCapped}%` }}
            />
          </div>
          <Field
            label="Resets"
            value={new Date(org.quotaResetAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          />
        </Section>

        {/* Status */}
        <Section title="Status">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {org.isActive ? "Active" : "Suspended"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {org.isActive
                  ? "Routing webhooks are being processed."
                  : "All routing requests are being rejected."}
              </p>
            </div>
            {org.isActive ? (
              <button
                onClick={() => setConfirmDialog({ open: true, type: "deactivate" })}
                disabled={saving}
                className="rounded-md border border-destructive px-4 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
              >
                Suspend
              </button>
            ) : (
              <button
                onClick={() => setConfirmDialog({ open: true, type: "activate" })}
                disabled={saving}
                className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                Activate
              </button>
            )}
          </div>
        </Section>

        {/* Danger Zone */}
        <div className="rounded-lg border border-destructive/40 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Soft Reset</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Delete all routing logs and reset the quota counter. Rules, users, and teams are kept.
                </p>
              </div>
              <button
                onClick={() => setConfirmDialog({ open: true, type: "soft_reset" })}
                disabled={saving}
                className="shrink-0 rounded-md border border-destructive/50 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
              >
                Soft Reset
              </button>
            </div>
            <div className="border-t pt-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Hard Reset</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Delete all data: rules, users, teams, logs. Billing info is preserved. Irreversible.
                </p>
              </div>
              <button
                onClick={() => setConfirmDialog({ open: true, type: "hard_reset" })}
                disabled={saving}
                className="shrink-0 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                Hard Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
