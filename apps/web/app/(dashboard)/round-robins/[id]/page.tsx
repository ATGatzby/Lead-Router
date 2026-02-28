"use client";

import { use, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  RotateCcw,
  UserPlus,
  Trash2,
  Search,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  status: "ACTIVE" | "PAUSED";
  assignmentCount: number;
  sharePercent: number;
  createdAt: string;
}

interface TeamDetail {
  id: string;
  name: string;
  description: string | null;
  pointerIndex: number;
  memberCount: number;
  activeCount: number;
  totalAssigned: number;
  nextMemberId: string | null;
  nextMemberName: string | null;
  members: Member[];
}

interface LicensedUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: teamId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Edit name/description dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Add members dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addDebouncedSearch, setAddDebouncedSearch] = useState("");
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());

  // Reset confirmation dialog
  const [resetOpen, setResetOpen] = useState(false);

  // Remove member confirmation
  const [removeMember, setRemoveMember] = useState<Member | null>(null);

  // ─── Queries ───────────────────────────────────────────────────────────────

  const teamQuery = useQuery<{ team: TeamDetail }>({
    queryKey: ["teams", teamId],
    queryFn: async () => {
      const res = await fetch(`/api/teams/${teamId}`);
      if (!res.ok) throw new Error("Team not found");
      return res.json();
    },
  });

  // Licensed users not yet on this team — loaded when add dialog opens
  const usersQuery = useQuery<{ users: LicensedUser[] }>({
    queryKey: ["users-for-team", teamId, addDebouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ licensed: "true", limit: "100" });
      if (addDebouncedSearch) params.set("q", addDebouncedSearch);
      const res = await fetch(`/api/users?${params}`);
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    enabled: addOpen,
  });

  const team = teamQuery.data?.team;
  const existingUserIds = new Set(team?.members.map((m) => m.userId) ?? []);

  // Filter out users already on the team
  const availableUsers = (usersQuery.data?.users ?? []).filter(
    (u) => !existingUserIds.has(u.id)
  );

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["teams", teamId] });

  const handleAddSearch = useCallback((val: string) => {
    setAddSearch(val);
    const t = setTimeout(() => setAddDebouncedSearch(val), 300);
    return () => clearTimeout(t);
  }, []);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const addMembersMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add members");
      return data;
    },
    onSuccess: (data) => {
      invalidate();
      setAddOpen(false);
      setAddSelected(new Set());
      setAddSearch("");
      setAddDebouncedSearch("");
      showToast(`${data.added} member${data.added !== 1 ? "s" : ""} added`);
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: "ACTIVE" | "PAUSED" }) => {
      const res = await fetch(`/api/teams/${teamId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update status");
      return data;
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove member");
      return data;
    },
    onSuccess: () => {
      invalidate();
      setRemoveMember(null);
      showToast("Member removed");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/teams/${teamId}/reset-pointer`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reset");
      return data;
    },
    onSuccess: () => {
      invalidate();
      setResetOpen(false);
      showToast("Rotation reset — next lead goes to position 1");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const editMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update team");
      return data;
    },
    onSuccess: () => {
      invalidate();
      setEditOpen(false);
      showToast("Team updated");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  if (teamQuery.isLoading) {
    return (
      <div className="text-center py-20 text-muted-foreground text-sm">
        Loading team...
      </div>
    );
  }

  if (teamQuery.isError || !team) {
    return (
      <div className="text-center py-20 text-destructive text-sm">
        Team not found.{" "}
        <button className="underline" onClick={() => router.back()}>
          Go back
        </button>
      </div>
    );
  }

  const activeMembers = team.members.filter((m) => m.status === "ACTIVE");
  const nextPosition =
    activeMembers.length > 0 ? (team.pointerIndex % activeMembers.length) + 1 : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/round-robins")}
            className="text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{team.name}</h1>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                aria-label="Edit team name"
                onClick={() => {
                  setEditName(team.name);
                  setEditDesc(team.description ?? "");
                  setEditOpen(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            {team.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{team.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetOpen(true)}
            disabled={team.memberCount === 0}
          >
            <RotateCcw className="h-4 w-4" />
            Reset Rotation
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add Members
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 rounded-xl border bg-card px-5 py-4 text-sm">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Members</p>
          <p className="font-semibold text-lg leading-tight">{team.memberCount}</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Active</p>
          <p className="font-semibold text-lg leading-tight">{team.activeCount}</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Total Assigned</p>
          <p className="font-semibold text-lg leading-tight">{team.totalAssigned}</p>
        </div>
        {team.nextMemberName && nextPosition !== null && (
          <>
            <div className="h-8 w-px bg-border" />
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Next Up</p>
              <p className="font-semibold leading-tight">
                {team.nextMemberName}
                <span className="text-xs text-muted-foreground font-normal ml-1.5">
                  (position {nextPosition} of {activeMembers.length})
                </span>
              </p>
            </div>
          </>
        )}
      </div>

      {/* Members table */}
      {team.members.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border">
          <p className="text-muted-foreground text-sm">No members yet.</p>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add Members
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Member</TableHead>
                <TableHead className="text-right w-28">Assigned</TableHead>
                <TableHead className="text-right w-24">% Share</TableHead>
                <TableHead className="text-center w-32">Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members.map((member) => {
                const isNext = member.userId === team.nextMemberId;
                const isPending =
                  toggleStatusMutation.isPending &&
                  (toggleStatusMutation.variables as { userId: string })?.userId === member.userId;

                return (
                  <TableRow
                    key={member.id}
                    className={isNext ? "bg-primary/5" : undefined}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium flex items-center gap-1.5">
                            {member.name}
                            {isNext && (
                              <Badge className="text-xs py-0 px-1.5 h-4">next</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{member.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {member.assignmentCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {member.sharePercent}%
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className={`text-xs ${
                            member.status === "ACTIVE"
                              ? "text-muted-foreground"
                              : "text-foreground font-medium"
                          }`}
                        >
                          Paused
                        </span>
                        <Switch
                          checked={member.status === "ACTIVE"}
                          disabled={isPending}
                          onCheckedChange={(checked) =>
                            toggleStatusMutation.mutate({
                              userId: member.userId,
                              status: checked ? "ACTIVE" : "PAUSED",
                            })
                          }
                          aria-label={`Toggle ${member.name} status`}
                        />
                        <span
                          className={`text-xs ${
                            member.status === "ACTIVE"
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                          }`}
                        >
                          Active
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemoveMember(member)}
                        aria-label={`Remove ${member.name}`}
                        className="text-muted-foreground hover:text-destructive"
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
      )}

      {/* ── Add Members Dialog ────────────────────────────────────────────────── */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false);
            setAddSelected(new Set());
            setAddSearch("");
            setAddDebouncedSearch("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Members</DialogTitle>
            <DialogDescription>
              Select licensed users to add to this team.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={addSearch}
                onChange={(e) => handleAddSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="rounded-md border max-h-64 overflow-y-auto">
              {usersQuery.isLoading && (
                <p className="text-center py-8 text-sm text-muted-foreground">Loading...</p>
              )}
              {usersQuery.isSuccess && availableUsers.length === 0 && (
                <p className="text-center py-8 text-sm text-muted-foreground">
                  {addDebouncedSearch
                    ? `No users match "${addDebouncedSearch}"`
                    : "All licensed users are already on this team."}
                </p>
              )}
              {availableUsers.map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent cursor-pointer border-b last:border-b-0"
                >
                  <Checkbox
                    checked={addSelected.has(user.id)}
                    onCheckedChange={(checked) => {
                      setAddSelected((prev) => {
                        const next = new Set(prev);
                        checked ? next.add(user.id) : next.delete(user.id);
                        return next;
                      });
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  {user.role && (
                    <span className="text-xs text-muted-foreground shrink-0">{user.role}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddOpen(false);
                setAddSelected(new Set());
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={addSelected.size === 0 || addMembersMutation.isPending}
              onClick={() => addMembersMutation.mutate(Array.from(addSelected))}
            >
              {addMembersMutation.isPending
                ? "Adding..."
                : `Add ${addSelected.size > 0 ? addSelected.size : ""} Member${addSelected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Confirmation Dialog ─────────────────────────────────────────── */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Rotation?</DialogTitle>
            <DialogDescription>
              The pointer will be reset to position 1. The next lead will go to{" "}
              <strong>{activeMembers[0]?.name ?? "the first active member"}</strong>.
              This action is logged in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
            >
              {resetMutation.isPending ? "Resetting..." : "Reset Rotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Team Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="detail-edit-name">Team name</Label>
              <Input
                id="detail-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editName.trim()) {
                    editMutation.mutate({ name: editName, description: editDesc });
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-edit-desc">Description (optional)</Label>
              <Input
                id="detail-edit-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!editName.trim() || editMutation.isPending}
              onClick={() => editMutation.mutate({ name: editName, description: editDesc })}
            >
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove Member Confirmation ────────────────────────────────────────── */}
      <Dialog open={!!removeMember} onOpenChange={(open) => !open && setRemoveMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeMember?.name}?</DialogTitle>
            <DialogDescription>
              They will be removed from this team&apos;s rotation. Their assignment history is
              preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveMember(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeMemberMutation.isPending}
              onClick={() => removeMemberMutation.mutate(removeMember!.userId)}
            >
              {removeMemberMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
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
