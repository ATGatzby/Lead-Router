"use client";

import { useQuery } from "@tanstack/react-query";
import { useCrmType } from "@/lib/hooks/use-crm-type";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE";

interface Props {
  assignmentType: AssignmentType;
  assigneeId: string;
  onTypeChange: (type: AssignmentType) => void;
  onAssigneeChange: (id: string) => void;
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Team {
  id: string;
  name: string;
}

interface Queue {
  id: string;
  name: string;
}

export function AssigneeSelect({
  assignmentType,
  assigneeId,
  onTypeChange,
  onAssigneeChange,
}: Props) {
  const { crmLabel, supportsQueues } = useCrmType();
  const usersQuery = useQuery<{ users: User[] }>({
    queryKey: ["users-licensed"],
    queryFn: async () => {
      const res = await fetch("/api/users?licensed=true&limit=200");
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    enabled: assignmentType === "USER",
  });

  const teamsQuery = useQuery<{ teams: Team[] }>({
    queryKey: ["teams"],
    queryFn: async () => {
      const res = await fetch("/api/teams");
      if (!res.ok) throw new Error("Failed to load teams");
      return res.json();
    },
    enabled: assignmentType === "ROUND_ROBIN",
  });

  const queuesQuery = useQuery<{ queues: Queue[] }>({
    queryKey: ["queues"],
    queryFn: async () => {
      const res = await fetch("/api/queues");
      if (!res.ok) throw new Error("Failed to load queues");
      return res.json();
    },
    enabled: assignmentType === "QUEUE",
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Assignment type</Label>
        <Select value={assignmentType} onValueChange={(v) => { onTypeChange(v as AssignmentType); onAssigneeChange(""); }}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="USER">Individual user</SelectItem>
            <SelectItem value="ROUND_ROBIN">Round robin team</SelectItem>
            {supportsQueues && (
              <SelectItem value="QUEUE">{crmLabel} queue</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {assignmentType === "USER" && (
        <div className="space-y-1.5">
          <Label>Assignee</Label>
          <Select value={assigneeId} onValueChange={onAssigneeChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a user…" />
            </SelectTrigger>
            <SelectContent>
              {usersQuery.isLoading && (
                <SelectItem value="__loading" disabled>Loading…</SelectItem>
              )}
              {(usersQuery.data?.users ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} — {u.email}
                </SelectItem>
              ))}
              {usersQuery.isSuccess && (usersQuery.data?.users ?? []).length === 0 && (
                <SelectItem value="__empty" disabled>No licensed users found</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {assignmentType === "ROUND_ROBIN" && (
        <div className="space-y-1.5">
          <Label>Round robin team</Label>
          <Select value={assigneeId} onValueChange={onAssigneeChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a team…" />
            </SelectTrigger>
            <SelectContent>
              {teamsQuery.isLoading && (
                <SelectItem value="__loading" disabled>Loading…</SelectItem>
              )}
              {(teamsQuery.data?.teams ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
              {teamsQuery.isSuccess && (teamsQuery.data?.teams ?? []).length === 0 && (
                <SelectItem value="__empty" disabled>No teams found</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {assignmentType === "QUEUE" && (
        <div className="space-y-1.5">
          <Label>{crmLabel} queue</Label>
          <Select value={assigneeId} onValueChange={onAssigneeChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a queue…" />
            </SelectTrigger>
            <SelectContent>
              {queuesQuery.isLoading && (
                <SelectItem value="__loading" disabled>Loading…</SelectItem>
              )}
              {(queuesQuery.data?.queues ?? []).map((q) => (
                <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>
              ))}
              {queuesQuery.isSuccess && (queuesQuery.data?.queues ?? []).length === 0 && (
                <SelectItem value="__empty" disabled>No queues synced yet</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
