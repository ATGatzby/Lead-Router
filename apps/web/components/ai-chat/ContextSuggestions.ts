import type { AgentContext } from "@/lib/ai/contexts";

export interface ContextSuggestion {
  text: string;
  icon?: string;
}

export const CONTEXT_SUGGESTIONS: Record<AgentContext, ContextSuggestion[]> = {
  "license-users": [
    { text: "License all users with the SDR role" },
    { text: "Which users are unlicensed but should have licenses?" },
    { text: "Show me current seat usage breakdown by department" },
    { text: "De-license users who haven't been routed to in 90 days" },
  ],
  "teams": [
    { text: "Create an SDR team with all licensed SDRs" },
    { text: "Rebalance weights on my Enterprise team evenly" },
    { text: "Which team has the most uneven workload distribution?" },
    { text: "Pause team members who are out of office" },
  ],
  "routing-rules": [
    { text: "Create a rule to route Enterprise leads to the Enterprise team" },
    { text: "Explain what my highest-priority lead rule does" },
    { text: "Which routing rule has the highest failure rate?" },
    { text: "Disable all dry-run rules" },
  ],
  "global": [
    { text: "Give me a full health check of my routing setup" },
    { text: "Which routing rule has the highest failure rate this week?" },
    { text: "Is the SDR team workload evenly balanced?" },
    { text: "Show me the routing volume trend for the last 30 days" },
    { text: "Find unlicensed users who should have licenses" },
    { text: "Which routing path generates the most pipeline revenue?" },
  ],
};
