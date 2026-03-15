"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MessageSquare, Webhook } from "lucide-react";

const WA_TEMPLATE = `*Lead Assigned* 🎯
Hello {{rep_name}},
A new *{{object_type}}* has been assigned to you.

*Record:* {{record_id}}
*Rule:* {{rule_name}}
*Time:* {{timestamp}}

Open in Salesforce: {{record_url}}`;

async function fetchNotifications() {
  const res = await fetch("/api/settings/notifications");
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json() as Promise<{ webhookUrl: string | null }>;
}

async function saveNotifications(data: { webhookUrl: string }) {
  const res = await fetch("/api/settings/notifications", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? "Failed to save");
  }
  return res.json();
}

export default function NotificationsSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings-notifications"],
    queryFn: fetchNotifications,
  });

  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [saved, setSaved] = useState(false);

  const currentUrl = webhookUrl !== "" ? webhookUrl : (data?.webhookUrl ?? "");

  const mutation = useMutation({
    mutationFn: () => saveNotifications({ webhookUrl: currentUrl }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings-notifications"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Webhook */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Routing Webhook</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          After each successful routing, the engine will POST a JSON payload to this URL.
          Useful for triggering Zapier workflows, Slack notifications, or custom CRMs.
        </p>

        <div className="space-y-1.5">
          <Label>Webhook URL</Label>
          <Input
            type="url"
            placeholder="https://hooks.zapier.com/hooks/catch/…"
            value={currentUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Must start with https://</p>
        </div>

        <div className="rounded-md bg-muted/50 border p-4 text-xs font-mono leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground mb-2">Sample payload</p>
          {JSON.stringify(
            {
              event: "LEAD_ROUTED",
              recordId: "00Q000000000001",
              objectType: "LEAD",
              assigneeName: "Priya Sharma",
              ruleName: "High-intent leads → BDR pool",
              timestamp: "2026-02-24T10:30:00Z",
            },
            null,
            2
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Webhook"}
          </Button>
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">Saved successfully</span>
          )}
          {mutation.isError && (
            <span className="text-sm text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : "Save failed"}
            </span>
          )}
        </div>
      </section>

      {/* WhatsApp template preview */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-green-600 dark:text-green-400" />
          <h2 className="font-semibold">WhatsApp Cloud API Template</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure your WhatsApp Cloud API webhook to receive routing notifications on WhatsApp.
          Use the pre-approved message template below as a starting point (submit via Meta Business Manager).
        </p>

        <div className="rounded-xl bg-[#dcf8c6] dark:bg-[#1a4731] p-4 max-w-sm">
          <div className="space-y-1">
            <pre className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground font-sans">
              {WA_TEMPLATE}
            </pre>
            <p className="text-[11px] text-muted-foreground text-right mt-2">10:30 AM ✓✓</p>
          </div>
        </div>

        <div className="rounded-md border p-4 space-y-1.5 text-sm">
          <p className="font-medium">Available template variables</p>
          {[
            ["{{rep_name}}", "Assigned rep's full name"],
            ["{{object_type}}", "LEAD / CONTACT / ACCOUNT"],
            ["{{record_id}}", "Salesforce record ID"],
            ["{{rule_name}}", "Matched routing rule name"],
            ["{{timestamp}}", "ISO 8601 event time"],
            ["{{record_url}}", "Deep link to Salesforce record"],
          ].map(([v, desc]) => (
            <div key={v} className="flex gap-2 text-xs">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono shrink-0">{v}</code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
