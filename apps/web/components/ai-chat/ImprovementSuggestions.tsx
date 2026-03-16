"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Lightbulb,
  Plus,
  AlertTriangle,
  BookMarked,
  MessageSquareText,
  TrendingDown,
} from "lucide-react";

/* ── Types ──────────────────────────────────────────────── */

interface FeedbackStats {
  positive: number;
  negative: number;
  total: number;
  score: number;
}

interface NegativeFeedback {
  userMessage: string;
  feedback: string | null;
  context: string | null;
  createdAt: string;
}

interface Suggestion {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  instructionName: string;
  instructionContent: string;
  type: "instruction" | "alias";
  severity: "warning" | "info";
}

/* ── Analysis logic ─────────────────────────────────────── */

function analyzeFeedback(
  stats: FeedbackStats,
  recentNegative: NegativeFeedback[]
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // High cancellation / negative rate
  if (stats.total >= 5 && stats.score < 70) {
    suggestions.push({
      id: "low-satisfaction",
      icon: <TrendingDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
      title: "Low satisfaction score",
      description: `Your AI satisfaction score is ${stats.score}%. Adding default instructions about your org's preferences can improve responses.`,
      instructionName: "Default preferences",
      instructionContent:
        "When I ask about metrics, default to the last 7 days unless I specify otherwise. Always include both absolute numbers and percentages.",
      type: "instruction",
      severity: "warning",
    });
  }

  // Check for "wrong field" patterns in negative feedback
  const wrongFieldMentions = recentNegative.filter(
    (f) =>
      f.feedback &&
      /wrong (field|column|data|metric)|incorrect (field|data)|not what i meant/i.test(f.feedback)
  );
  if (wrongFieldMentions.length >= 2) {
    suggestions.push({
      id: "wrong-field",
      icon: <BookMarked className="h-5 w-5 text-red-600 dark:text-red-400" />,
      title: "Field confusion detected",
      description: `${wrongFieldMentions.length} negative reviews mention incorrect fields. Add vocabulary aliases to clarify your naming conventions.`,
      instructionName: "Field definitions",
      instructionContent:
        '"Pipeline" refers to the Amount field on Opportunity. "Conversion" means Lead Status changed to "Qualified". "Win rate" = Closed Won / (Closed Won + Closed Lost).',
      type: "alias",
      severity: "warning",
    });
  }

  // Check for specificity complaints
  const vagueComplaints = recentNegative.filter(
    (f) =>
      f.feedback &&
      /too (vague|general|broad)|not specific|more detail|need more/i.test(f.feedback)
  );
  if (vagueComplaints.length >= 2) {
    suggestions.push({
      id: "too-vague",
      icon: <MessageSquareText className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
      title: "Responses too vague",
      description: `${vagueComplaints.length} users found responses too general. Add instructions to be more specific with data.`,
      instructionName: "Be specific with data",
      instructionContent:
        "Always include specific numbers, percentages, and date ranges in responses. When showing lists, include at least the top 5 items. Break down data by team or rule when relevant.",
      type: "instruction",
      severity: "info",
    });
  }

  // High negative count even with decent score
  if (stats.negative >= 10 && stats.score >= 70) {
    suggestions.push({
      id: "growing-negatives",
      icon: <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
      title: "Growing negative feedback",
      description: `You have ${stats.negative} negative reviews. Consider adding context-specific instructions for the pages where issues occur most.`,
      instructionName: "Context-aware responses",
      instructionContent:
        "When on the Teams page, always check workload balance first before suggesting changes. When on Routing Rules, always show the current failure rate alongside any suggestions.",
      type: "instruction",
      severity: "info",
    });
  }

  // No feedback at all — encourage usage
  if (stats.total === 0) {
    suggestions.push({
      id: "no-feedback",
      icon: <Lightbulb className="h-5 w-5 text-blue-600 dark:text-blue-400" />,
      title: "Start collecting feedback",
      description:
        "No feedback data yet. Use the thumbs up/down buttons in AI chat to help improve suggestions over time.",
      instructionName: "",
      instructionContent: "",
      type: "instruction",
      severity: "info",
    });
  }

  return suggestions;
}

/* ── Component ──────────────────────────────────────────── */

export function ImprovementSuggestions() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-feedback-stats"],
    queryFn: async () => {
      const res = await fetch("/api/ai/feedback");
      if (!res.ok) throw new Error("Failed to fetch feedback");
      return res.json() as Promise<{
        stats: FeedbackStats;
        recentNegative: NegativeFeedback[];
      }>;
    },
    staleTime: 60_000,
  });

  const addInstructionMutation = useMutation({
    mutationFn: async (body: { type: string; name: string; content: string }) => {
      const res = await fetch("/api/ai/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Instruction added");
      queryClient.invalidateQueries({ queryKey: ["ai-prompts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return null;
  if (!data) return null;

  const suggestions = analyzeFeedback(data.stats, data.recentNegative);

  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">Improvement Suggestions</h3>
        <span className="rounded bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
          Based on feedback
        </span>
      </div>

      <div className="space-y-2.5">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border bg-card p-4 flex items-start gap-3"
          >
            <div className="mt-0.5 shrink-0">{s.icon}</div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold">{s.title}</h4>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {s.description}
              </p>
              {s.instructionContent && (
                <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">
                    Suggested {s.type}:
                  </p>
                  <p className="text-xs leading-relaxed">{s.instructionContent}</p>
                </div>
              )}
            </div>
            {s.instructionContent && (
              <button
                onClick={() =>
                  addInstructionMutation.mutate({
                    type: s.type,
                    name: s.instructionName,
                    content: s.instructionContent,
                  })
                }
                disabled={addInstructionMutation.isPending}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/50 px-2.5 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 transition hover:bg-violet-100 dark:hover:bg-violet-900"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
