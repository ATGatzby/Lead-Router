"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

function buildApiParams(searchParams: URLSearchParams): string {
  const range = searchParams.get("range") || "30d";
  const objectType = searchParams.get("objectType") || "";
  const nowMs = Math.floor(Date.now() / 60000) * 60000;
  const now = new Date(nowMs);
  let from: Date;
  switch (range) {
    case "today": from = new Date(now); from.setHours(0,0,0,0); break;
    case "7d": from = new Date(nowMs - 7 * 86400000); break;
    case "90d": from = new Date(nowMs - 90 * 86400000); break;
    default: from = new Date(nowMs - 30 * 86400000);
  }
  const params = new URLSearchParams();
  params.set("from", from.toISOString());
  params.set("to", now.toISOString());
  if (objectType) params.set("objectType", objectType);
  return params.toString();
}

function FairnessGauge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-600" : score >= 60 ? "text-yellow-600" : "text-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="text-2xl font-bold">{score}</div>
      <div className={cn("text-xs font-medium", color)}>
        {score >= 80 ? "Fair" : score >= 60 ? "Moderate" : "Uneven"}
      </div>
    </div>
  );
}

function TeamsContent() {
  const searchParams = useSearchParams();
  const apiParams = useMemo(() => buildApiParams(searchParams), [searchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-teams", apiParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/teams?${apiParams}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const teams = data?.teams || [];

  if (isLoading) {
    return <div className="mt-8 text-center text-muted-foreground">Loading...</div>;
  }

  if (teams.length === 0) {
    return <div className="mt-8 text-center text-muted-foreground">No team routing data for this period</div>;
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-4">
      {teams.map((team: any) => (
        <div key={team.teamId} className="rounded-lg border bg-card p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{team.teamName}</h3>
              <p className="text-xs text-muted-foreground">{team.total.toLocaleString()} records routed</p>
            </div>
            <FairnessGauge score={team.fairnessScore} />
          </div>

          {/* Member distribution */}
          <div className="space-y-2">
            {team.members.map((m: any) => (
              <div key={m.assigneeId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{m.assigneeName}</span>
                  <span className="text-muted-foreground">
                    {m.total} ({m.actualPercent}%)
                    <span className={cn(
                      "ml-1",
                      Math.abs(m.actualPercent - m.targetPercent) > 10 ? "text-red-500" : "text-muted-foreground"
                    )}>
                      target: {m.targetPercent}%
                    </span>
                  </span>
                </div>
                <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
                  {/* Actual */}
                  <div
                    className="absolute h-full rounded-full bg-primary"
                    style={{ width: `${m.actualPercent}%` }}
                  />
                  {/* Target marker */}
                  <div
                    className="absolute top-0 h-full w-0.5 bg-foreground/40"
                    style={{ left: `${m.targetPercent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TeamsPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><div className="h-32 animate-pulse rounded-lg bg-muted" /></div>}>
      <TeamsContent />
    </Suspense>
  );
}
