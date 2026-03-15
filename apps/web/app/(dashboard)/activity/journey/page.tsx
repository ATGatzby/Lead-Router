"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ExternalLink, Copy, Check } from "lucide-react";
import { JourneyTimeline } from "@/components/record-journey/JourneyTimeline";

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

export default function RecordJourneyPage() {
  const [inputValue, setInputValue] = useState("");
  const [recordId, setRecordId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery<{
    recordId: string;
    entries: JourneyEntry[];
  }>({
    queryKey: ["record-journey", recordId],
    queryFn: async () => {
      const res = await fetch(`/api/routing-logs/journey/${recordId}`);
      if (!res.ok) throw new Error("Failed to fetch journey");
      return res.json();
    },
    enabled: !!recordId,
  });

  function handleSearch() {
    const trimmed = inputValue.trim();
    if (/^[a-zA-Z0-9]{15,18}$/.test(trimmed)) {
      setRecordId(trimmed);
    }
  }

  function handleCopyId() {
    if (recordId) {
      navigator.clipboard.writeText(recordId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex items-center gap-3 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Enter Salesforce Record ID (e.g. 00Q...)"
            className="pl-9"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <Button onClick={handleSearch} disabled={!inputValue.trim()}>
          Search
        </Button>
      </div>

      {/* Results */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-muted animate-pulse"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load journey data. Please check the Record ID and try again.
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Record header */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center gap-3">
              <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                {data.recordId}
              </code>
              <button
                onClick={handleCopyId}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              <a
                href={`https://login.salesforce.com/${data.recordId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                Open in Salesforce
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {data.entries.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Routed {data.entries.length} time
                {data.entries.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>

          {/* Timeline */}
          {data.entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No routing events found for this record.
            </div>
          ) : (
            <JourneyTimeline entries={data.entries} />
          )}
        </div>
      )}

      {/* Empty state */}
      {!recordId && !isLoading && (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Record Journey</p>
          <p className="text-sm mt-1">
            Enter a Salesforce Record ID to see the complete routing decision
            trail.
          </p>
        </div>
      )}
    </div>
  );
}
