"use client";

interface TimingBreakdownProps {
  timing: {
    totalMs: number;
    cooldownCheckMs?: number;
    matchPhaseMs?: number;
    evaluationMs?: number;
    assignmentMs?: number;
    sfdcUpdateMs?: number;
  };
}

const PHASE_CONFIG = [
  { key: "cooldownCheckMs", label: "Cooldown", color: "bg-sky-400" },
  { key: "matchPhaseMs", label: "Match", color: "bg-violet-400" },
  { key: "evaluationMs", label: "Evaluation", color: "bg-blue-400" },
  { key: "assignmentMs", label: "Assignment", color: "bg-green-400" },
  { key: "sfdcUpdateMs", label: "SFDC Update", color: "bg-amber-400" },
] as const;

export function TimingBreakdown({ timing }: TimingBreakdownProps) {
  const total = timing.totalMs || 1;

  const phases = PHASE_CONFIG.map((cfg) => {
    const ms = (timing as Record<string, number | undefined>)[cfg.key];
    return ms != null && ms > 0
      ? { label: cfg.label, ms, color: cfg.color, pct: (ms / total) * 100 }
      : null;
  }).filter(Boolean) as Array<{ label: string; ms: number; color: string; pct: number }>;

  if (phases.length === 0) return null;

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Timing Breakdown</span>
        <span className="text-xs text-muted-foreground">{timing.totalMs}ms total</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
        {phases.map((phase) => (
          <div
            key={phase.label}
            className={`${phase.color} transition-all`}
            style={{ width: `${Math.max(phase.pct, 2)}%` }}
            title={`${phase.label}: ${phase.ms}ms`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {phases.map((phase) => (
          <div key={phase.label} className="flex items-center gap-1.5 text-xs">
            <div className={`h-2 w-2 rounded-full ${phase.color}`} />
            <span className="text-muted-foreground">{phase.label}</span>
            <span className="font-mono">{phase.ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}
