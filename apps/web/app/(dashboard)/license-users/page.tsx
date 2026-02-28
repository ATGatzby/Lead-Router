"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, Users, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  sfdcUserId: string;
  name: string;
  email: string;
  role: string | null;
  profile: string | null;
  department: string | null;
  isLicensed: boolean;
  lastRoutedAt: string | null;
}

interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  pages: number;
}

interface StatsResponse {
  seatsPurchased: number;
  seatsUsed: number;
}

interface SyncResult {
  upserted: number;
  deactivated: number;
  syncedAt: string;
  users: User[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLastRouted(date: string | null) {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LicenseUsersPage() {
  const qc = useQueryClient();

  // Filter state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [licensed, setLicensed] = useState<"all" | "licensed" | "unlicensed">("all");
  const [page, setPage] = useState(1);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Toast / feedback state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Upgrade dialog
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeMeta, setUpgradeMeta] = useState<{ seatsPurchased: number; seatsUsed: number } | null>(null);

  // De-license feedback dialog (shows team cascade info)
  const [cascadeOpen, setCascadeOpen] = useState(false);
  const [cascadeInfo, setCascadeInfo] = useState<{ userName: string; teams: string[] } | null>(null);

  // Delete confirmation dialog (single user)
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

  // Bulk delete confirmation dialog
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // ─── Sync Dialog State ──────────────────────────────────────────────────────
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<"all" | "select" | null>(null);
  const [syncStep, setSyncStep] = useState<1 | 2>(1);
  const [syncedUsers, setSyncedUsers] = useState<User[]>([]);
  const [syncDialogSelected, setSyncDialogSelected] = useState<Set<string>>(new Set());
  const [syncDialogSearch, setSyncDialogSearch] = useState("");

  // Search debounce
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    setPage(1);
    const t = setTimeout(() => setDebouncedSearch(val), 300);
    return () => clearTimeout(t);
  }, []);

  // ─── Queries ───────────────────────────────────────────────────────────────

  const usersQuery = useQuery<UsersResponse>({
    queryKey: ["users", debouncedSearch, licensed, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (licensed === "licensed") params.set("licensed", "true");
      if (licensed === "unlicensed") params.set("licensed", "false");
      const res = await fetch(`/api/users?${params}`);
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });

  const statsQuery = useQuery<StatsResponse>({
    queryKey: ["users/stats"],
    queryFn: async () => {
      const res = await fetch("/api/users/stats");
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["users/stats"] });
  };

  // Sync mutation — used inside the dialog
  const syncMutation = useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      const res = await fetch("/api/users", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: (data) => {
      invalidate();
      // Store synced users and advance to step 2
      setSyncedUsers(data.users ?? []);
      setSyncStep(2);
    },
    onError: () => showToast("Sync failed", "error"),
  });

  const licenseMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "license" | "de-license" }) => {
      const res = await fetch(`/api/users/${id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? "unknown", ...data };
      return data;
    },
    onSuccess: (data, variables) => {
      if (data.error === "seat_cap_exceeded") {
        setUpgradeMeta({ seatsPurchased: data.seatsPurchased, seatsUsed: data.seatsUsed });
        setUpgradeOpen(true);
        return;
      }
      if (variables.action === "de-license" && data.removedFromTeams?.length > 0) {
        const user = usersQuery.data?.users.find((u) => u.id === variables.id);
        setCascadeInfo({ userName: user?.name ?? "User", teams: data.removedFromTeams });
        setCascadeOpen(true);
      }
      invalidate();
    },
    onError: () => showToast("Action failed", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete user");
      return data;
    },
    onSuccess: () => {
      invalidate();
      setDeleteUser(null);
      showToast("User deleted");
    },
    onError: () => showToast("Failed to delete user", "error"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const res = await fetch("/api/users/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete users");
      return data;
    },
    onSuccess: (data) => {
      setSelected(new Set());
      setBulkDeleteOpen(false);
      invalidate();
      showToast(`${data.deleted} user${data.deleted === 1 ? "" : "s"} deleted`);
    },
    onError: () => showToast("Bulk delete failed", "error"),
  });

  const bulkMutation = useMutation({
    mutationFn: async ({ userIds, action }: { userIds: string[]; action: "license" | "de-license" }) => {
      const res = await fetch("/api/users/bulk-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, action }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? "unknown", ...data };
      return data;
    },
    onSuccess: (data, variables) => {
      if (data.error === "seat_cap_exceeded") {
        setUpgradeMeta({ seatsPurchased: data.seatsPurchased, seatsUsed: data.seatsUsed });
        setUpgradeOpen(true);
        return;
      }
      setSelected(new Set());
      invalidate();
      const action = variables.action === "license" ? "licensed" : "de-licensed";
      showToast(`${data.affected} user${data.affected === 1 ? "" : "s"} ${action}`);
    },
    onError: () => showToast("Bulk action failed", "error"),
  });

  // ─── Sync Dialog handlers ──────────────────────────────────────────────────

  const openSyncDialog = () => {
    setSyncMode(null);
    setSyncStep(1);
    setSyncedUsers([]);
    setSyncDialogSelected(new Set());
    setSyncDialogSearch("");
    setSyncDialogOpen(true);
  };

  const closeSyncDialog = () => {
    setSyncDialogOpen(false);
    setSyncMode(null);
    setSyncStep(1);
    setSyncedUsers([]);
    setSyncDialogSelected(new Set());
    setSyncDialogSearch("");
  };

  const handleSyncAndContinue = () => {
    syncMutation.mutate();
  };

  const handleLicenseFromDialog = () => {
    if (syncMode === "all") {
      const unlicensedIds = syncedUsers.filter((u) => !u.isLicensed).map((u) => u.id);
      bulkMutation.mutate(
        { userIds: unlicensedIds, action: "license" },
        {
          onSuccess: (data) => {
            if (!data.error) {
              closeSyncDialog();
              showToast(`${data.affected} user${data.affected === 1 ? "" : "s"} licensed`);
            }
          },
        }
      );
    } else {
      bulkMutation.mutate(
        { userIds: Array.from(syncDialogSelected), action: "license" },
        {
          onSuccess: (data) => {
            if (!data.error) {
              closeSyncDialog();
              showToast(`${data.affected} user${data.affected === 1 ? "" : "s"} licensed`);
            }
          },
        }
      );
    }
  };

  // ─── Selection helpers ─────────────────────────────────────────────────────

  const users = usersQuery.data?.users ?? [];
  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const someSelected = users.some((u) => selected.has(u.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        users.forEach((u) => next.delete(u.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        users.forEach((u) => next.add(u.id));
        return next;
      });
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Sync dialog user list helpers ────────────────────────────────────────

  const filteredSyncUsers = syncedUsers.filter((u) => {
    if (!syncDialogSearch) return true;
    const q = syncDialogSearch.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const unlicensedSyncUsers = filteredSyncUsers.filter((u) => !u.isLicensed);
  const allSyncSelected =
    unlicensedSyncUsers.length > 0 &&
    unlicensedSyncUsers.every((u) => syncDialogSelected.has(u.id));

  const toggleAllSyncUsers = () => {
    if (allSyncSelected) {
      setSyncDialogSelected(new Set());
    } else {
      setSyncDialogSelected(new Set(unlicensedSyncUsers.map((u) => u.id)));
    }
  };

  const toggleSyncUser = (id: string) => {
    setSyncDialogSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const stats = statsQuery.data;
  const seatsFull = stats ? stats.seatsUsed >= stats.seatsPurchased : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">License Users</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage which Salesforce users can receive routed records.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Seat counter */}
          {stats && (
            <div className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border ${seatsFull ? "text-destructive border-destructive/30 bg-destructive/5" : "text-foreground border-border bg-muted/50"}`}>
              <span className={`size-2 rounded-full ${seatsFull ? "bg-destructive" : "bg-primary"}`} />
              {stats.seatsUsed} of {stats.seatsPurchased} seats used
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={openSyncDialog}
          >
            <RefreshCw />
            Sync Users
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, role..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={licensed}
          onValueChange={(v) => {
            setLicensed(v as typeof licensed);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            <SelectItem value="licensed">Licensed</SelectItem>
            <SelectItem value="unlicensed">Unlicensed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>User</TableHead>
              <TableHead className="hidden md:table-cell">Role / Profile</TableHead>
              <TableHead className="hidden lg:table-cell">Last Routed</TableHead>
              <TableHead className="text-right w-32">Licensed</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {usersQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  Loading users...
                </TableCell>
              </TableRow>
            )}

            {usersQuery.isError && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-destructive">
                  Failed to load users. Try refreshing.
                </TableCell>
              </TableRow>
            )}

            {usersQuery.isSuccess && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  <Users className="mx-auto mb-2 size-8 opacity-30" />
                  {debouncedSearch
                    ? `No users match "${debouncedSearch}"`
                    : "No users synced yet. Click Sync Users to import from Salesforce."}
                </TableCell>
              </TableRow>
            )}

            {users.map((user) => {
              const isPending =
                licenseMutation.isPending &&
                (licenseMutation.variables as { id: string })?.id === user.id;

              return (
                <TableRow
                  key={user.id}
                  data-state={selected.has(user.id) ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(user.id)}
                      onCheckedChange={() => toggleOne(user.id)}
                      aria-label={`Select ${user.name}`}
                    />
                  </TableCell>

                  <TableCell>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-muted-foreground text-xs">{user.email}</div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-col gap-0.5">
                      {user.role && <span className="text-sm">{user.role}</span>}
                      {user.profile && (
                        <span className="text-xs text-muted-foreground">{user.profile}</span>
                      )}
                      {!user.role && !user.profile && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {formatLastRouted(user.lastRoutedAt)}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Badge
                        variant={user.isLicensed ? "default" : "outline"}
                        className="text-xs min-w-[72px] justify-center"
                      >
                        {user.isLicensed ? "Licensed" : "Unlicensed"}
                      </Badge>
                      <Switch
                        checked={user.isLicensed}
                        disabled={isPending || (seatsFull && !user.isLicensed)}
                        onCheckedChange={(checked) => {
                          if (seatsFull && checked) {
                            setUpgradeMeta({
                              seatsPurchased: stats!.seatsPurchased,
                              seatsUsed: stats!.seatsUsed,
                            });
                            setUpgradeOpen(true);
                            return;
                          }
                          licenseMutation.mutate({
                            id: user.id,
                            action: checked ? "license" : "de-license",
                          });
                        }}
                        aria-label={`${user.isLicensed ? "De-license" : "License"} ${user.name}`}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${user.name}`}
                      onClick={() => setDeleteUser(user)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {usersQuery.isSuccess && (usersQuery.data?.pages ?? 1) > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, usersQuery.data.total)} of{" "}
            {usersQuery.data.total} users
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= (usersQuery.data?.pages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl border bg-background px-4 py-3 shadow-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            onClick={() => bulkMutation.mutate({ userIds: Array.from(selected), action: "license" })}
            disabled={bulkMutation.isPending}
          >
            License Selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkMutation.mutate({ userIds: Array.from(selected), action: "de-license" })}
            disabled={bulkMutation.isPending}
          >
            De-License Selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setBulkDeleteOpen(true)}
            disabled={bulkDeleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
            Delete Selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* ── Sync & License Dialog ────────────────────────────────────────────── */}
      <Dialog open={syncDialogOpen} onOpenChange={(open) => { if (!open) closeSyncDialog(); }}>
        <DialogContent className="max-w-lg">
          {syncStep === 1 && (
            <>
              <DialogHeader>
                <DialogTitle>Sync &amp; License Users</DialogTitle>
                <DialogDescription>
                  Sync users from Salesforce, then choose how to license them.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-2">
                <p className="text-sm font-medium text-foreground">Who do you want to license?</p>
                <div className="grid grid-cols-2 gap-3">
                  {/* All Users */}
                  <button
                    onClick={() => setSyncMode("all")}
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors hover:bg-accent",
                      syncMode === "all" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Users className="h-5 w-5 text-primary" />
                      {syncMode === "all" && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-sm font-medium">All Users</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      License everyone synced from Salesforce
                    </p>
                  </button>

                  {/* Select Users */}
                  <button
                    onClick={() => setSyncMode("select")}
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors hover:bg-accent",
                      syncMode === "select" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Search className="h-5 w-5 text-primary" />
                      {syncMode === "select" && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-sm font-medium">Select Users</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pick specific users to license
                    </p>
                  </button>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeSyncDialog}>
                  Cancel
                </Button>
                <Button
                  disabled={!syncMode || syncMutation.isPending}
                  onClick={handleSyncAndContinue}
                >
                  {syncMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    "Sync & Continue"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {syncStep === 2 && syncMode === "all" && (
            <>
              <DialogHeader>
                <DialogTitle>License All Users</DialogTitle>
                <DialogDescription>
                  Sync complete. {syncedUsers.length} user{syncedUsers.length !== 1 ? "s" : ""} found
                  from Salesforce.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total users synced</span>
                  <span className="font-medium">{syncedUsers.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Already licensed</span>
                  <span className="font-medium">{syncedUsers.filter((u) => u.isLicensed).length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Will be licensed</span>
                  <span className="font-semibold text-primary">
                    {syncedUsers.filter((u) => !u.isLicensed).length}
                  </span>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeSyncDialog}>
                  Cancel
                </Button>
                <Button
                  disabled={bulkMutation.isPending || syncedUsers.filter((u) => !u.isLicensed).length === 0}
                  onClick={handleLicenseFromDialog}
                >
                  {bulkMutation.isPending ? "Licensing..." : `License ${syncedUsers.filter((u) => !u.isLicensed).length} Users`}
                </Button>
              </DialogFooter>
            </>
          )}

          {syncStep === 2 && syncMode === "select" && (
            <>
              <DialogHeader>
                <DialogTitle>Select Users to License</DialogTitle>
                <DialogDescription>
                  {syncedUsers.length} user{syncedUsers.length !== 1 ? "s" : ""} synced from Salesforce.
                  Select who to license.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email..."
                    value={syncDialogSearch}
                    onChange={(e) => setSyncDialogSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <div className="rounded-md border overflow-hidden">
                  {/* Select all row */}
                  {unlicensedSyncUsers.length > 0 && (
                    <label className="flex items-center gap-3 px-3 py-2 bg-muted/30 border-b cursor-pointer hover:bg-accent">
                      <Checkbox
                        checked={allSyncSelected}
                        onCheckedChange={toggleAllSyncUsers}
                        aria-label="Select all unlicensed"
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        Select all unlicensed ({unlicensedSyncUsers.length})
                      </span>
                    </label>
                  )}

                  <div className="max-h-64 overflow-y-auto">
                    {filteredSyncUsers.length === 0 && (
                      <p className="text-center py-8 text-sm text-muted-foreground">
                        {syncDialogSearch ? `No users match "${syncDialogSearch}"` : "No users found."}
                      </p>
                    )}
                    {filteredSyncUsers.map((user) => (
                      <label
                        key={user.id}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0",
                          user.isLicensed
                            ? "opacity-50 cursor-not-allowed"
                            : "cursor-pointer hover:bg-accent"
                        )}
                      >
                        <Checkbox
                          checked={user.isLicensed || syncDialogSelected.has(user.id)}
                          disabled={user.isLicensed}
                          onCheckedChange={() => !user.isLicensed && toggleSyncUser(user.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{user.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                        {user.isLicensed ? (
                          <Badge variant="default" className="text-xs shrink-0">Licensed</Badge>
                        ) : user.role ? (
                          <span className="text-xs text-muted-foreground shrink-0">{user.role}</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </div>

                {syncDialogSelected.size > 0 && (
                  <p className="text-xs text-muted-foreground text-right">
                    {syncDialogSelected.size} user{syncDialogSelected.size !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeSyncDialog}>
                  Cancel
                </Button>
                <Button
                  disabled={syncDialogSelected.size === 0 || bulkMutation.isPending}
                  onClick={handleLicenseFromDialog}
                >
                  {bulkMutation.isPending
                    ? "Licensing..."
                    : `License ${syncDialogSelected.size > 0 ? syncDialogSelected.size : ""} User${syncDialogSelected.size !== 1 ? "s" : ""}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteUser} onOpenChange={(open) => { if (!open) setDeleteUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{deleteUser?.name}&quot;?</DialogTitle>
            <DialogDescription>
              This will permanently remove the user from the system and all Round Robin teams.
              {deleteUser?.isLicensed && " Their licensed seat will be freed."}
              {" "}This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUser(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deleteUser!.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} user{selected.size !== 1 ? "s" : ""}?</DialogTitle>
            <DialogDescription>
              This will permanently remove {selected.size === 1 ? "this user" : `all ${selected.size} selected users`} from
              the system and any Round Robin teams they belong to. Licensed seats will be freed.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => bulkDeleteMutation.mutate(Array.from(selected))}
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : `Delete ${selected.size} User${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade dialog */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seat limit reached</DialogTitle>
            <DialogDescription>
              You&apos;ve used all {upgradeMeta?.seatsPurchased} seats. Upgrade your plan to license
              more users.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)}>
              Cancel
            </Button>
            <Button asChild>
              <a href="/settings#billing">Upgrade Plan</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Round Robin cascade info */}
      <Dialog open={cascadeOpen} onOpenChange={setCascadeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User de-licensed</DialogTitle>
            <DialogDescription>
              {cascadeInfo?.userName} was removed from the following Round Robin team
              {(cascadeInfo?.teams.length ?? 0) > 1 ? "s" : ""}:
            </DialogDescription>
          </DialogHeader>
          <ul className="rounded-md border bg-muted/50 px-4 py-3 text-sm space-y-1">
            {cascadeInfo?.teams.map((t) => <li key={t}>• {t}</li>)}
          </ul>
          <DialogFooter>
            <Button onClick={() => setCascadeOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
            toast.type === "error"
              ? "bg-destructive text-white"
              : "bg-foreground text-background"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
