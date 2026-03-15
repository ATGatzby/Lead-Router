"use client";

interface AssignmentCardProps {
  assignment: {
    type?: string;
    assigneeName?: string;
    assigneeId?: string;
    teamId?: string;
    teamName?: string;
    roundRobinDetail?: { teamMemberCount: number; selectedIndex: number };
    source?: string;
    branchLabel?: string;
  } | null;
  assigneeName: string | null;
  assignmentType: string | null;
  teamName: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  MATCH_OWNER: "Matched record owner",
  MATCH_CUSTOM: "Custom match assignment",
  BRANCH: "Branch assignment",
  DEFAULT_OWNER: "Default owner",
  LEGACY: "Legacy rule assignment",
};

export function AssignmentCard({
  assignment,
  assigneeName,
  assignmentType,
  teamName,
}: AssignmentCardProps) {
  const name = assignment?.assigneeName ?? assigneeName;
  const type = assignment?.type ?? assignmentType;
  const team = assignment?.teamName ?? teamName;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
          {name?.charAt(0) ?? "?"}
        </div>
        <div>
          <p className="text-sm font-medium">{name ?? "Unknown"}</p>
          <p className="text-xs text-muted-foreground">
            {type === "ROUND_ROBIN" ? "Round Robin" : type === "QUEUE" ? "Queue" : "Direct"} assignment
          </p>
        </div>
      </div>

      {team && (
        <p className="text-xs text-muted-foreground">
          Team: <span className="font-medium text-foreground">{team}</span>
          {assignment?.roundRobinDetail && (
            <span>
              {" "}
              (position {assignment.roundRobinDetail.selectedIndex + 1} of{" "}
              {assignment.roundRobinDetail.teamMemberCount})
            </span>
          )}
        </p>
      )}

      {assignment?.source && (
        <p className="text-xs text-muted-foreground">
          Source: {SOURCE_LABELS[assignment.source] ?? assignment.source}
          {assignment.branchLabel && ` — ${assignment.branchLabel}`}
        </p>
      )}
    </div>
  );
}
