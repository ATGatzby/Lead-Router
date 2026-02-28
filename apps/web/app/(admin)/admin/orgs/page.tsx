"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface OrgRow {
  id: string;
  sfdcOrgId: string | null;
  plan: "FREE" | "PAID";
  isActive: boolean;
  seatsPurchased: number;
  seatsUsed: number;
  routingQuotaUsed: number;
  routingQuotaLimit: number;
  quotaPercent: number;
  createdAt: string;
  billingInfo: { entityName: string | null } | null;
}

async function fetchOrgs(): Promise<OrgRow[]> {
  const res = await fetch("/api/admin/orgs");
  if (!res.ok) return [];
  const data = await res.json();
  return data.orgs ?? [];
}

function QuotaBar({ percent }: { percent: number }) {
  const capped = Math.min(percent, 100);
  const color =
    capped >= 100 ? "bg-destructive" : capped >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{percent}%</span>
    </div>
  );
}

function NewCustomerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    entityName: "",
    inviteEmail: "",
    plan: "FREE" as "FREE" | "PAID",
    seatsPurchased: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [inviteLink, setInviteLink] = useState("");

  function reset() {
    setForm({ entityName: "", inviteEmail: "", plan: "FREE", seatsPurchased: "" });
    setError("");
    setInviteLink("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        inviteEmail: form.inviteEmail.trim(),
        plan: form.plan,
      };
      if (form.entityName.trim()) body.entityName = form.entityName.trim();
      if (form.seatsPurchased) body.seatsPurchased = Number(form.seatsPurchased);

      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create customer");
        return;
      }
      setInviteLink(data.inviteLink ?? "");
      onCreated();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  // Success state — show invite link
  if (inviteLink) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background rounded-lg border shadow-lg w-full max-w-md mx-4">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="font-semibold text-sm">Customer Created</h2>
            <button
              onClick={() => { reset(); onClose(); }}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="rounded-md bg-green-500/10 border border-green-500/20 px-4 py-3">
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                Invite email sent!
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                The customer will receive a link to create their account.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Registration link (copy for your records)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteLink}
                  className="w-full rounded-md border bg-muted px-3 py-2 text-xs font-mono text-muted-foreground cursor-default"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(inviteLink)}
                  className="shrink-0 rounded-md border px-3 py-2 text-xs hover:bg-muted transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => { reset(); onClose(); }}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-sm">New Customer</h2>
          <button
            onClick={() => { reset(); onClose(); }}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Invite Email */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Invite Email <span className="text-destructive">*</span>
            </label>
            <input
              type="email"
              value={form.inviteEmail}
              onChange={(e) => setForm((f) => ({ ...f, inviteEmail: e.target.value }))}
              placeholder="customer@company.com"
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              We&apos;ll send a registration link to this address (expires in 72 hours).
            </p>
          </div>

          {/* Entity Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Entity / Company Name</label>
            <input
              type="text"
              value={form.entityName}
              onChange={(e) => setForm((f) => ({ ...f, entityName: e.target.value }))}
              placeholder="Acme Corp"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Plan + Seats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Plan</label>
              <select
                value={form.plan}
                onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value as "FREE" | "PAID" }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="FREE">FREE — 5 seats</option>
                <option value="PAID">PAID — 20 seats</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Seats <span className="text-muted-foreground font-normal">(optional override)</span>
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={form.seatsPurchased}
                onChange={(e) => setForm((f) => ({ ...f, seatsPurchased: e.target.value }))}
                placeholder={form.plan === "FREE" ? "5" : "20"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
            A webhook secret is auto-generated. The customer will connect their Salesforce org during onboarding.
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Creating…" : "Create & Send Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminOrgsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: fetchOrgs,
  });

  function handleCreated() {
    queryClient.invalidateQueries({ queryKey: ["admin-orgs"] });
  }

  return (
    <>
      <NewCustomerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Organizations</h1>
            <p className="text-sm text-muted-foreground">{orgs.length} total</p>
          </div>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + New Customer
          </button>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plan</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Seats</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Routing Quota</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && orgs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No organizations yet. Click <strong>+ New Customer</strong> to add one.
                  </td>
                </tr>
              )}
              {orgs.map((org) => (
                <tr key={org.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {org.billingInfo?.entityName ?? (
                        <span className="text-muted-foreground italic">—</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {org.sfdcOrgId ?? (
                        <span className="italic font-sans">CRM not connected</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        org.plan === "PAID"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {org.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {org.seatsUsed} / {org.seatsPurchased}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        {org.routingQuotaUsed} / {org.routingQuotaLimit}
                      </div>
                      <QuotaBar percent={org.quotaPercent} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        org.isActive
                          ? "bg-green-500/10 text-green-600"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {org.isActive ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orgs/${org.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
