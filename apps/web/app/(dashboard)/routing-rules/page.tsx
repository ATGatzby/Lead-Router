"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Plus,
  Copy,
  Pencil,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TableSkeleton } from "@/components/skeletons/table-skeleton";

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function objectLabel(type: ObjectType): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RoutingRulesPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // Delete dialog
  const [deleteRule, setDeleteRule] = useState<Rule | null>(null);

  // ─── Query ────────────────────────────────────────────────────────────────

  const rulesQuery = useQuery<RulesResponse>({
    queryKey: ["rules"],
    queryFn: async () => {
      const res = await fetch("/api/rules");
      if (!res.ok) throw new Error("Failed to load rules");
      return res.json();
    },
  });

  const rules = rulesQuery.data?.rules ?? [];

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rules"] });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rules/${id}/status`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update status");
      return data;
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
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
      toast.success("Rule cloned");
    },
    onError: (err: Error) => toast.error(err.message),
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
      toast.success("Rule deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const syncFieldsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/fields/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      return data;
    },
    onSuccess: (data) => toast.success(`Synced ${data.synced} fields from Salesforce`),
    onError: (err: Error) => toast.error(err.message),
  });

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
          <Button size="sm" onClick={() => router.push("/routing-rules/new")}>
            <Plus className="h-4 w-4 mr-1" />
            New Route
          </Button>
        </div>
      </div>

      {/* Loading / Error */}
      {rulesQuery.isLoading && (
        <TableSkeleton rows={4} columns={4} />
      )}
      {rulesQuery.isError && (
        <div className="text-center py-16 text-destructive text-sm">
          Failed to load rules. Try refreshing.
        </div>
      )}

      {/* Empty state */}
      {rulesQuery.isSuccess && rules.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center">
            <ArrowRightLeft className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <p className="text-muted-foreground text-sm">
            No routing rules yet.
          </p>
          <p className="text-xs text-muted-foreground">Create your first route to start automatically assigning records.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/routing-rules/new")}
          >
            <Plus className="h-4 w-4 mr-1" />
            Create your first rule
          </Button>
        </div>
      )}

      {/* Rules table */}
      {rules.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route Name</TableHead>
                <TableHead className="w-[100px]">Object</TableHead>
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id} className={rule.status === "INACTIVE" ? "opacity-60" : ""}>
                  {/* Route Name */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{rule.name}</span>
                      {rule.isDryRun && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          Dry run
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Object */}
                  <TableCell>
                    <Badge variant="outline">{objectLabel(rule.objectType)}</Badge>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Switch
                      checked={rule.status === "ACTIVE"}
                      onCheckedChange={() => statusMutation.mutate(rule.id)}
                      disabled={statusMutation.isPending}
                      aria-label={`Toggle ${rule.name}`}
                    />
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
              {deleteMutation.isPending ? "Deleting..." : "Delete Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
