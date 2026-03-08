"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Plus,
  GripVertical,
  Copy,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

type ObjectType = "LEAD" | "CONTACT" | "ACCOUNT";
type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE";

interface Rule {
  id: string;
  name: string;
  objectType: ObjectType;
  triggerEvent: string;
  priority: number;
  status: "ACTIVE" | "INACTIVE";
  assignmentType: AssignmentType | null;
  assigneeUserName: string | null;
  assigneeTeamName: string | null;
  assigneeQueueName: string | null;
  conditionCount: number;
  isDryRun: boolean;
  updatedAt: string;
  // New Route Builder fields
  branches?: Array<{ id: string }>;
  matchConfig?: object | null;
  defaultOwnerType?: string | null;
}

interface RulesResponse {
  rules: Rule[];
}

const TABS: { label: string; value: ObjectType }[] = [
  { label: "Lead", value: "LEAD" },
  { label: "Contact", value: "CONTACT" },
  { label: "Account", value: "ACCOUNT" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function assigneeName(rule: Rule): string {
  if (rule.assignmentType === "USER") return rule.assigneeUserName ?? "—";
  if (rule.assignmentType === "ROUND_ROBIN") return rule.assigneeTeamName ?? "—";
  return rule.assigneeQueueName ?? "—";
}

function assigneeLabel(type: AssignmentType | null): string {
  if (type === "ROUND_ROBIN") return "Team";
  if (type === "QUEUE") return "Queue";
  return "User";
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RoutingRulesPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [tab, setTab] = useState<ObjectType>("LEAD");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Delete dialog
  const [deleteRule, setDeleteRule] = useState<Rule | null>(null);

  // Drag state
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // ─── Query ────────────────────────────────────────────────────────────────

  const rulesQuery = useQuery<RulesResponse>({
    queryKey: ["rules", tab],
    queryFn: async () => {
      const res = await fetch(`/api/rules?object=${tab}`);
      if (!res.ok) throw new Error("Failed to load rules");
      return res.json();
    },
  });

  const rules = rulesQuery.data?.rules ?? [];

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rules", tab] });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rules/${id}/status`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update status");
      return data;
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const cloneMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rules/${id}/clone`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to clone rule");
      return data;
    },
    onSuccess: () => {
      invalidate();
      showToast("Rule cloned");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete rule");
      return data;
    },
    onSuccess: () => {
      invalidate();
      setDeleteRule(null);
      showToast("Rule deleted");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const reorderMutation = useMutation({
    mutationFn: async (ruleIds: string[]) => {
      const res = await fetch("/api/rules/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reorder");
      return data;
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const syncFieldsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/fields/sync?object=${tab}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      return data;
    },
    onSuccess: (data) => showToast(`Synced ${data.synced} fields from Salesforce`),
    onError: (err: Error) => showToast(err.message, "error"),
  });

  // ─── Drag-to-reorder ─────────────────────────────────────────────────────

  const handleDragStart = (idx: number) => {
    dragIndex.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(idx);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIndex.current;
    if (fromIdx === null || fromIdx === dropIdx) {
      setDragOver(null);
      return;
    }

    const reordered = [...rules];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(dropIdx, 0, moved);

    setDragOver(null);
    dragIndex.current = null;

    reorderMutation.mutate(reordered.map((r) => r.id));
  };

  const handleDragEnd = () => {
    setDragOver(null);
    dragIndex.current = null;
  };

  const movePriority = (idx: number, direction: "up" | "down") => {
    const reordered = [...rules];
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= reordered.length) return;
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    reorderMutation.mutate(reordered.map((r) => r.id));
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Routing Rules</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Define which records get routed and who receives them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncFieldsMutation.mutate()}
            disabled={syncFieldsMutation.isPending}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5 mr-1", syncFieldsMutation.isPending && "animate-spin")}
            />
            Sync Fields
          </Button>
          <Button size="sm" onClick={() => router.push(`/routing-rules/new?object=${tab}`)}>
            <Plus className="h-4 w-4 mr-1" />
            New Route
          </Button>
        </div>
      </div>

      {/* Object Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Loading / Error */}
      {rulesQuery.isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading rules…</div>
      )}
      {rulesQuery.isError && (
        <div className="text-center py-16 text-destructive text-sm">
          Failed to load rules. Try refreshing.
        </div>
      )}

      {/* Empty state */}
      {rulesQuery.isSuccess && rules.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ArrowRightLeft className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">
            No {tab.toLowerCase()} routing rules yet.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/routing-rules/new?object=${tab}`)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Create your first rule
          </Button>
        </div>
      )}

      {/* Rules table */}
      {rules.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[32px_52px_1fr_140px_160px_110px_88px] items-center gap-3 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span />
            <span>Priority</span>
            <span>Rule name</span>
            <span>Conditions</span>
            <span>Assignee</span>
            <span>Status</span>
            <span />
          </div>

          {/* Rows */}
          {rules.map((rule, idx) => (
            <div
              key={rule.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={cn(
                "grid grid-cols-[32px_52px_1fr_140px_160px_110px_88px] items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-colors bg-card",
                rule.status === "INACTIVE" && "opacity-60",
                dragOver === idx && "bg-primary/5"
              )}
            >
              {/* Drag handle */}
              <div className="flex items-center">
                <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab active:cursor-grabbing" />
              </div>

              {/* Priority with up/down */}
              <div className="flex items-center gap-1">
                <span className="text-sm font-semibold tabular-nums text-muted-foreground w-5">
                  {rule.priority}
                </span>
                <div className="flex flex-col">
                  <button
                    onClick={() => movePriority(idx, "up")}
                    disabled={idx === 0 || reorderMutation.isPending}
                    className="text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 leading-none"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => movePriority(idx, "down")}
                    disabled={idx === rules.length - 1 || reorderMutation.isPending}
                    className="text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 leading-none"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Name */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{rule.name}</span>
                  {rule.isDryRun && (
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      Dry run
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Trigger: {rule.triggerEvent}
                </div>
              </div>

              {/* Conditions */}
              <div className="text-sm text-muted-foreground">
                {rule.conditionCount === 0 ? (
                  <span className="italic">Catch-all</span>
                ) : (
                  `${rule.conditionCount} condition${rule.conditionCount !== 1 ? "s" : ""}`
                )}
              </div>

              {/* Assignee */}
              <div className="min-w-0">
                <div className="text-sm truncate font-medium">{assigneeName(rule)}</div>
                <div className="text-xs text-muted-foreground">{assigneeLabel(rule.assignmentType)}</div>
              </div>

              {/* Status toggle */}
              <div>
                <button
                  onClick={() => statusMutation.mutate(rule.id)}
                  disabled={statusMutation.isPending}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 transition-colors",
                    rule.status === "ACTIVE"
                      ? "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      rule.status === "ACTIVE" ? "bg-green-500" : "bg-muted-foreground/50"
                    )}
                  />
                  {rule.status === "ACTIVE" ? "Active" : "Inactive"}
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground"
                  onClick={() => {
                    router.push(`/routing-rules/${rule.id}/flow`);
                  }}
                  aria-label="Edit rule"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground"
                  onClick={() => cloneMutation.mutate(rule.id)}
                  disabled={cloneMutation.isPending}
                  aria-label="Clone rule"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteRule(rule)}
                  aria-label="Delete rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <Dialog
        open={!!deleteRule}
        onOpenChange={(open) => { if (!open) setDeleteRule(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{deleteRule?.name}&quot;?</DialogTitle>
            <DialogDescription>
              This routing rule and all its conditions will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRule(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deleteRule!.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
            toast.type === "error" ? "bg-destructive text-white" : "bg-foreground text-background"
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
