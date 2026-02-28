"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { GitFork, Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  activeCount: number;
  totalAssigned: number;
  createdAt: string;
}

interface TeamsResponse {
  teams: Team[];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RoundRobinsPage() {
  const qc = useQueryClient();
  const router = useRouter();

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTeam, setDeleteTeam] = useState<Team | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ─── Query ─────────────────────────────────────────────────────────────────

  const teamsQuery = useQuery<TeamsResponse>({
    queryKey: ["teams"],
    queryFn: async () => {
      const res = await fetch("/api/teams");
      if (!res.ok) throw new Error("Failed to load teams");
      return res.json();
    },
  });

  const teams = teamsQuery.data?.teams ?? [];

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["teams"] });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create team");
      return data;
    },
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setCreateName("");
      setCreateDesc("");
      showToast("Team created");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/teams/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return { error: data.error, rules: data.rules };
      return data;
    },
    onSuccess: (data) => {
      if (data?.error) {
        setDeleteError(data.error);
        return;
      }
      invalidate();
      setDeleteOpen(false);
      setDeleteTeam(null);
      showToast("Team deleted");
    },
    onError: () => showToast("Failed to delete team", "error"),
  });

  // ─── Dialog openers ────────────────────────────────────────────────────────

  const openDelete = (team: Team) => {
    setDeleteTeam(team);
    setDeleteError(null);
    setDeleteOpen(true);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Round Robin Teams</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Create pools of reps for fair, sequential lead distribution.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Team
        </Button>
      </div>

      {/* Team list */}
      {teamsQuery.isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Loading teams...
        </div>
      )}

      {teamsQuery.isError && (
        <div className="text-center py-16 text-destructive text-sm">
          Failed to load teams. Try refreshing.
        </div>
      )}

      {teamsQuery.isSuccess && teams.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <GitFork className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">No teams yet.</p>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create your first team
          </Button>
        </div>
      )}

      {teams.length > 0 && (
        <div className="grid gap-3">
          {teams.map((team) => (
            <div
              key={team.id}
              className="rounded-xl border bg-card px-5 py-4 flex items-center gap-4"
            >
              {/* Icon */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <GitFork className="h-4 w-4" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{team.name}</span>
                  {team.activeCount < team.memberCount && team.memberCount > 0 && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {team.activeCount} active
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {team.memberCount} member{team.memberCount !== 1 ? "s" : ""}
                  </span>
                  {team.totalAssigned > 0 && (
                    <span>{team.totalAssigned} leads assigned</span>
                  )}
                  {team.description && (
                    <span className="hidden md:inline truncate max-w-xs">{team.description}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/round-robins/${team.id}`)}
                >
                  Manage
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => router.push(`/round-robins/${team.id}`)}
                  aria-label="Edit team"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openDelete(team)}
                  aria-label="Delete team"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Round Robin Team</DialogTitle>
            <DialogDescription>
              Give the team a name and an optional description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-name">Team name</Label>
              <Input
                id="create-name"
                placeholder="e.g. West Coast SDRs"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && createName.trim()) {
                    createMutation.mutate({ name: createName, description: createDesc });
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-desc">Description (optional)</Label>
              <Input
                id="create-desc"
                placeholder="e.g. Handles inbound leads from the Pacific time zone"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!createName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: createName, description: createDesc })}
            >
              {createMutation.isPending ? "Creating..." : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ────────────────────────────────────────────────────── */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOpen(false);
            setDeleteTeam(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{deleteTeam?.name}&quot;?</DialogTitle>
            <DialogDescription>
              This will permanently remove the team and all its members. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {deleteError}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                setDeleteError(null);
                deleteMutation.mutate(deleteTeam!.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Team"}
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
