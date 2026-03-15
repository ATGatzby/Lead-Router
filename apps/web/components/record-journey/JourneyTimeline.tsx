"use client";

import { JourneyStep } from "./JourneyStep";

interface JourneyEntry {
  id: string;
  eventType: string;
  status: string;
  ruleName: string | null;
  pathLabel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assignmentType: string | null;
  teamName: string | null;
  routingDurationMs: number | null;
  decisionTrace: unknown;
  createdAt: string;
}

export function JourneyTimeline({ entries }: { entries: JourneyEntry[] }) {
  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-6">
        {entries.map((entry, i) => (
          <JourneyStep key={entry.id} entry={entry} isFirst={i === 0} />
        ))}
      </div>
    </div>
  );
}
