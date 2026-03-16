"use client";

import { useState, useMemo, useRef, useCallback } from "react";
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
  Zap,
  Search,
  Play,
  ChevronDown,
  Loader2,
  Lock,
  ExternalLink,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TableSkeleton } from "@/components/skeletons/table-skeleton";

// ─── License Types ──────────────────────────────────────────────────────────

interface LicenseResponse {
  tier: string;
  limits: { maxRules: number; maxSeats: number };
  usage: { rules: number; seats: number; orgs: number };
  licenseKey: string | null;
}

// ─── Types ─────────────────────────────────────────────────────────────────

type ObjectType = "LEAD" | "CONTACT" | "ACCOUNT";
type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE";
type FilterType = "ALL" | "REALTIME" | "SCHEDULED";

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
  // Route Builder fields
  branches?: Array<{ id: string }>;
  matchConfig?: object | null;
  defaultOwnerType?: string | null;
  // Route type fields
  routeType: "REALTIME" | "SCHEDULED";
  scheduleFrequency: string | null;
  scheduleTime: string | null;
  scheduleTimezone: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunRecords: number | null;
  totalRuns: number;
  totalRecordsRouted: number;
  activeBulkRun: {
    id: string;
    status: string;
    recordsFound: number;
    recordsProcessed: number;
    recordsRouted: number;
    recordsFailed: number;
  } | null;
}

interface BulkRunStatus {
  status: string;
  recordsFound?: number;
  recordsProcessed: number;
  recordsRouted: number;
  recordsFailed: number;
}

interface RulesResponse {
  rules: Rule[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function objectLabel(type: ObjectType): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function formatSchedule(rule: Rule): string {
  if (!rule.scheduleFrequency || rule.scheduleFrequency === "once" || rule.scheduleFrequency === "ONE_TIME") {
    return "One-time";
  }
  const freq = rule.scheduleFrequency.charAt(0).toUpperCase() + rule.scheduleFrequency.slice(1).toLowerCase();
  const time = rule.scheduleTime ?? "6:00 AM";
  const tz = rule.scheduleTimezone ?? "UTC";
  return `${freq} \u00b7 ${time} ${tz}`;
}

function formatLastRun(rule: Rule): string {
  if (!rule.lastRunAt) return "Never run";
  const date = new Date(rule.lastRunAt);
  const formatted = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const records = rule.lastRunRecords ?? 0;
  return `Last run: ${formatted} \u00b7 ${records} record${records !== 1 ? "s" : ""}`;
}

// ─── New Route Dropdown ────────────────────────────────────────────────────

function NewRouteDropdown({ atLimit = false }: { atLimit?: boolean }) {
  const router = useRouter();

  if (atLimit) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button size="sm" disabled className="pointer-events-none">
                <Lock className="h-4 w-4 mr-1" />
                New Route
                <Badge
                  variant="outline"
                  className="ml-1.5 text-[10px] border-amber-400 dark:border-amber-600 text-amber-500 dark:text-amber-400"
                >
                  Pro
                </Badge>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Rule limit reached. Upgrade to Pro.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Route
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push("/routing-rules/new?type=realtime")}>
          <Zap className="h-4 w-4 mr-2 text-violet-600 dark:text-violet-400" />
          Real-Time Route
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/routing-rules/new?type=scheduled")}>
          <Search className="h-4 w-4 mr-2 text-teal-600 dark:text-teal-400" />
          Scheduled Route
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RoutingRulesPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // Filter & search state
  const [filterType, setFilterType] = useState<FilterType>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Delete dialog
  const [deleteRule, setDeleteRule] = useState<Rule | null>(null);

  // Run progress state
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [completedRuleId, setCompletedRuleId] = useState<string | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressStartRef = useRef<number>(0);

  // Bulk run polling state
  const [activeBulkRunId, setActiveBulkRunId] = useState<string | null>(null);
  const [bulkRunRuleId, setBulkRunRuleId] = useState<string | null>(null);

  const cleanupProgress = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // Poll bulk run status when active
  const bulkStatusQuery = useQuery<BulkRunStatus>({
    queryKey: ["bulk-run", activeBulkRunId],
    queryFn: async () => {
      const res = await fetch(`/api/bulk-run/${activeBulkRunId}/status`);
      if (!res.ok) throw new Error("Failed to fetch bulk run status");
      return res.json();
    },
    refetchInterval: 2000,
    enabled: !!activeBulkRunId,
  });

  // When bulk run completes, update UI (needs rules, so completion check is below query)
  const bulkStatus = bulkStatusQuery.data;
  const prevBulkStatusRef = useRef<string | null>(null);

  const startRunProgress = useCallback(
    (ruleId: string, ruleName: string) => {
      cleanupProgress();
      setRunningRuleId(ruleId);
      setRunProgress({ phase: "Querying Salesforce...", pct: 0 });
      progressStartRef.current = Date.now();

      // Fire the actual API call concurrently
      fetch(`/api/rules/${ruleId}/run`, { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          // If the run returned a bulkRunId, switch to polling mode
          if (data.bulkRunId) {
            cleanupProgress();
            setActiveBulkRunId(data.bulkRunId);
            setBulkRunRuleId(ruleId);
            setRunProgress({ phase: "Processing records...", pct: 5 });
            return;
          }

          // Non-bulk run — fast-forward to 100%
          cleanupProgress();
          setRunProgress({ phase: "Complete!", pct: 100 });

          const records = data.recordsRouted ?? data.records ?? 0;

          setTimeout(() => {
            setRunningRuleId(null);
            setRunProgress(null);
            setCompletedRuleId(ruleId);
            qc.invalidateQueries({ queryKey: ["rules"] });
            toast.success(`${ruleName} completed -- ${records} records routed`);

            // Clear completed state after 2 seconds
            setTimeout(() => setCompletedRuleId(null), 2000);
          }, 500);
        })
        .catch((err) => {
          cleanupProgress();
          setRunningRuleId(null);
          setRunProgress(null);
          toast.error(err.message ?? "Failed to run route");
        });

      // Simulate progress client-side (until bulk run polling takes over)
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - progressStartRef.current;

        if (elapsed < 800) {
          const pct = Math.round((elapsed / 800) * 15);
          setRunProgress({ phase: "Querying Salesforce...", pct });
        } else if (elapsed < 1300) {
          const pct = Math.round(15 + ((elapsed - 800) / 500) * 20);
          setRunProgress({ phase: "Matching records...", pct });
        } else if (elapsed < 3000) {
          const progress3 = (elapsed - 1300) / 1700;
          const pct = Math.round(35 + progress3 * 50);
          const counter = Math.round(progress3 * 247);
          setRunProgress({ phase: `Routing records... ${counter}/247`, pct });
        } else if (elapsed < 3500) {
          const pct = Math.round(85 + ((elapsed - 3000) / 500) * 15);
          setRunProgress({ phase: "Completing...", pct });
        } else {
          cleanupProgress();
        }
      }, 50);
    },
    [cleanupProgress, qc]
  );

  const cancelBulkRun = useCallback(async () => {
    if (!activeBulkRunId) return;
    try {
      const res = await fetch(`/api/bulk-run/${activeBulkRunId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Cancel failed");
      toast.info("Cancellation requested...");
    } catch {
      toast.error("Failed to cancel run");
    }
  }, [activeBulkRunId]);

  // ─── Query ────────────────────────────────────────────────────────────────

  const rulesQuery = useQuery<RulesResponse>({
    queryKey: ["rules"],
    queryFn: async () => {
      const res = await fetch("/api/rules");
      if (!res.ok) throw new Error("Failed to load rules");
      return res.json();
    },
  });

  const licenseQuery = useQuery<LicenseResponse>({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license");
      if (!res.ok) throw new Error("Failed to load license");
      return res.json();
    },
  });

  const rules = rulesQuery.data?.rules ?? [];

  // Auto-detect active bulk runs from rules data (e.g., on page load)
  const detectedBulkRunRef = useRef(false);
  if (!detectedBulkRunRef.current && rules.length > 0 && !activeBulkRunId && !runningRuleId) {
    const ruleWithActiveBulk = rules.find((r) => r.activeBulkRun?.status === "RUNNING");
    if (ruleWithActiveBulk && ruleWithActiveBulk.activeBulkRun) {
      detectedBulkRunRef.current = true;
      setActiveBulkRunId(ruleWithActiveBulk.activeBulkRun.id);
      setBulkRunRuleId(ruleWithActiveBulk.id);
      setRunningRuleId(ruleWithActiveBulk.id);
      setRunProgress({ phase: "Processing records...", pct: 0 });
    }
  }

  // Bulk run completion detection (must be after rules query)
  if (bulkStatus && activeBulkRunId) {
    const isTerminal = bulkStatus.status !== "RUNNING";
    if (isTerminal && prevBulkStatusRef.current === "RUNNING") {
      const rId = bulkRunRuleId;
      const rule = rules.find((r) => r.id === rId);
      const ruleName = rule?.name ?? "Route";

      setTimeout(() => {
        setActiveBulkRunId(null);
        setBulkRunRuleId(null);
        setRunningRuleId(null);
        setRunProgress(null);
        setCompletedRuleId(rId);
        qc.invalidateQueries({ queryKey: ["rules"] });

        if (bulkStatus.status === "CANCELLED") {
          toast.info(`${ruleName} cancelled`);
        } else {
          toast.success(
            `${ruleName} completed -- ${bulkStatus.recordsRouted} records routed`
          );
        }

        setTimeout(() => setCompletedRuleId(null), 2000);
      }, 300);
    }
    prevBulkStatusRef.current = bulkStatus.status;
  }

  // License gating: maxRules of -1 means unlimited (Pro)
  const maxRules = licenseQuery.data?.limits.maxRules ?? -1;
  const atRuleLimit = maxRules !== -1 && rules.length >= maxRules;

  // ─── Derived counts & filtered list ────────────────────────────────────

  const counts = useMemo(() => {
    const realtime = rules.filter((r) => (r.routeType ?? "REALTIME") === "REALTIME").length;
    const scheduled = rules.filter((r) => r.routeType === "SCHEDULED").length;
    return { all: rules.length, realtime, scheduled };
  }, [rules]);

  const filteredRules = useMemo(() => {
    let list = rules;
    if (filterType === "REALTIME") {
      list = list.filter((r) => (r.routeType ?? "REALTIME") === "REALTIME");
    } else if (filterType === "SCHEDULED") {
      list = list.filter((r) => r.routeType === "SCHEDULED");
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }
    return list;
  }, [rules, filterType, searchQuery]);

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rules"] });
    qc.invalidateQueries({ queryKey: ["license"] });
  };

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

  const runMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rules/${id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to run route");
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Route executed successfully");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold font-display">Routing Rules</h1>
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
          <NewRouteDropdown atLimit={atRuleLimit} />
        </div>
      </div>

      {/* Upgrade banner when at rule limit */}
      {atRuleLimit && (
        <div className="flex items-center justify-between rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 px-4 py-3">
          <p className="text-sm text-violet-700 dark:text-violet-300">
            You&apos;ve used all {maxRules} free routing rules. Upgrade to Pro for unlimited rules.
          </p>
          <a
            href="https://openedgeai.tech/pricing"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" className="bg-gradient-to-r from-violet-600 to-purple-600 dark:from-violet-500 dark:to-purple-500 text-white shadow-sm hover:shadow-md hover:from-violet-700 hover:to-purple-700 dark:hover:from-violet-600 dark:hover:to-purple-600 border-0">
              Upgrade to Pro
              <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </a>
        </div>
      )}

      {/* Loading / Error */}
      {rulesQuery.isLoading && <TableSkeleton rows={4} columns={4} />}
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
          <p className="text-muted-foreground text-sm">No routing rules yet.</p>
          <p className="text-xs text-muted-foreground">
            Create your first route to start automatically assigning records.
          </p>
          <NewRouteDropdown atLimit={atRuleLimit} />
        </div>
      )}

      {/* Filter bar + Card list */}
      {rules.length > 0 && (
        <>
          {/* Filter Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {(
                [
                  { key: "ALL", label: "All", count: counts.all },
                  { key: "REALTIME", label: "Real-Time", count: counts.realtime },
                  { key: "SCHEDULED", label: "Scheduled", count: counts.scheduled },
                ] as const
              ).map(({ key, label, count }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filterType === key ? "default" : "ghost"}
                  className="text-xs"
                  onClick={() => setFilterType(key)}
                >
                  {label} ({count})
                </Button>
              ))}
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search routes..."
                className="text-sm pl-8 h-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Card List */}
          <div className="space-y-2">
            {filteredRules.map((rule) => {
              const type = rule.routeType ?? "REALTIME";
              const isRealtime = type === "REALTIME";
              const branchCount = rule.branches?.length ?? 0;

              const isRunning = runningRuleId === rule.id;
              const isCompleted = completedRuleId === rule.id;

              return (
                <div
                  key={rule.id}
                  className={cn(
                    "border rounded-xl p-4",
                    rule.status === "INACTIVE" && "opacity-50",
                    isRunning && "border-l-2 border-l-teal-400 dark:border-l-teal-500",
                    isCompleted && "border-l-2 border-l-green-400 dark:border-l-green-500"
                  )}
                >
                <div className="flex items-center gap-4">
                  {/* Type indicator icon */}
                  <div
                    className={cn(
                      "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                      isRealtime
                        ? "bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-400"
                        : "bg-teal-100 dark:bg-teal-900 text-teal-600 dark:text-teal-400"
                    )}
                  >
                    {isRealtime ? (
                      <Zap className="h-5 w-5" />
                    ) : (
                      <Search className="h-5 w-5" />
                    )}
                  </div>

                  {/* Info section */}
                  <div className="flex-1 min-w-0">
                    {/* Top row: name + badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{rule.name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] shrink-0",
                          isRealtime
                            ? "border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400"
                            : "border-teal-300 dark:border-teal-700 text-teal-600 dark:text-teal-400"
                        )}
                      >
                        {isRealtime ? "Real-Time" : "Scheduled"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {objectLabel(rule.objectType)}
                      </Badge>
                      {!isRealtime && (
                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0 border-teal-300 dark:border-teal-700 text-teal-600 dark:text-teal-400"
                        >
                          {formatSchedule(rule)}
                        </Badge>
                      )}
                      {rule.isDryRun && (
                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0 border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400"
                        >
                          Dry run
                        </Badge>
                      )}
                    </div>
                    {/* Bottom row: contextual info */}
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {isRealtime ? (
                        <>
                          {rule.triggerEvent && (
                            <span>Trigger: {rule.triggerEvent}</span>
                          )}
                          {branchCount > 0 && (
                            <span>
                              {rule.triggerEvent ? " \u00b7 " : ""}
                              {branchCount} path{branchCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        <span>{isRunning ? "Running now..." : formatLastRun(rule)}</span>
                      )}
                    </p>
                  </div>

                  {/* Stats section */}
                  <div className="flex-shrink-0 flex gap-6">
                    {/* Stat: Total Routed */}
                    <div className="text-center">
                      <div className="text-sm font-semibold">
                        {rule.totalRecordsRouted ?? 0}
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase">
                        Total Routed
                      </div>
                    </div>
                    {/* Stat: Paths or Runs */}
                    <div className="text-center">
                      <div className="text-sm font-semibold">
                        {isRealtime ? branchCount : (rule.totalRuns ?? 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase">
                        {isRealtime ? "Paths" : "Runs"}
                      </div>
                    </div>
                  </div>

                  {/* Status + Actions */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <Switch
                      checked={rule.status === "ACTIVE"}
                      onCheckedChange={() => statusMutation.mutate(rule.id)}
                      disabled={statusMutation.isPending}
                      aria-label={`Toggle ${rule.name}`}
                    />
                    {!isRealtime && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950"
                        onClick={() => startRunProgress(rule.id, rule.name)}
                        disabled={!!runningRuleId}
                        aria-label="Run route"
                      >
                        {isRunning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground"
                      onClick={() => router.push(`/routing-rules/${rule.id}/flow`)}
                      aria-label="Edit rule"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {atRuleLimit ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0}>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground pointer-events-none"
                                disabled
                                aria-label="Clone rule"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            Rule limit reached. Upgrade to Pro.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
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
                    )}
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

                  {/* Inline run progress */}
                  {isRunning && runProgress && (() => {
                    const isBulk = activeBulkRunId && bulkRunRuleId === rule.id;
                    const bs = isBulk ? bulkStatus : null;
                    const found = bs?.recordsFound ?? 0;
                    const processed = bs?.recordsProcessed ?? 0;
                    const routed = bs?.recordsRouted ?? 0;
                    const failed = bs?.recordsFailed ?? 0;
                    const pct = isBulk && bs
                      ? (found > 0 ? Math.round((processed / found) * 100) : runProgress.pct)
                      : runProgress.pct;
                    const phase = isBulk && bs
                      ? `Processing ${processed.toLocaleString()} of ${found.toLocaleString()} records (${routed.toLocaleString()} routed${failed > 0 ? `, ${failed.toLocaleString()} failed` : ""})`
                      : runProgress.phase;

                    return (
                      <div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-3">
                          <div
                            className="h-full bg-gradient-to-r from-teal-500 to-teal-400 dark:from-teal-600 dark:to-teal-500 rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                          <span>{phase}</span>
                          <div className="flex items-center gap-2">
                            <span>{pct}%</span>
                            {isBulk && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                                onClick={cancelBulkRun}
                              >
                                <Square className="h-2.5 w-2.5 mr-0.5" />
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {/* No results for current filter */}
            {filteredRules.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No routes match your filters.
              </div>
            )}
          </div>
        </>
      )}

      {/* Delete Confirm Dialog */}
      <Dialog
        open={!!deleteRule}
        onOpenChange={(open) => {
          if (!open) setDeleteRule(null);
        }}
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
