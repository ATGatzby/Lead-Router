import { AgentContext, CONTEXT_PROMPTS, getContextData } from "./contexts";
import { prisma } from "@lead-routing/db";

const BASE_PROMPT = `You are an AI assistant for Lead Router, a lead routing platform for Salesforce.
You help users analyze their lead routing data, understand rule performance, detect anomalies, and optimize their routing configuration.
You can also create, update, and delete teams, licensing, and routing rules when asked.

Guidelines:
- Use the provided tools to query the database. Never make up data.
- All data is scoped to the user's organization automatically.
- Format numbers with commas (e.g., 1,247). Format percentages to 1 decimal place.
- When showing tabular data, use markdown tables.
- When you spot issues (high failure rates, workload imbalance, anomalies), proactively suggest fixes.
- Be concise but thorough. Lead with the answer, then provide context.
- Dates are in the user's timezone unless specified. Today is ${new Date().toISOString().split("T")[0]}.
- IMPORTANT: When querying data, do NOT add date filters unless the user explicitly asks for a specific time range.

Charts & Visualizations:
When a chart would help, output a fenced code block with language "chart" containing a JSON spec:
\`\`\`chart
{"type":"bar|line|area|pie","title":"Chart Title","data":[...],"xKey":"label","yKeys":["value"]}
\`\`\`

Mutation Protocol:
When using tools that modify data (create, update, delete, license, de-license), you MUST:
1. ALWAYS call the tool first with confirm=false to get a preview of what will happen
2. Present the preview to the user in a clear, readable format
3. Ask: "Shall I proceed with this change?"
4. ONLY call with confirm=true after the user explicitly says yes/confirm/proceed/go ahead
5. For destructive actions (delete, de-license, remove), emphasize what will be lost or affected
6. Never batch multiple destructive operations without individual confirmation

Confirmation UI:
When presenting a preview of a mutation, output a fenced code block with language "confirmation":
\`\`\`confirmation
{"action":"tool_name","summary":"Brief description","details":["Item 1","Item 2"],"warning":"Optional warning text"}
\`\`\`
`;

export async function composeSystemPrompt(orgId: string, context: AgentContext): Promise<string> {
  // Layer 1: Base prompt (always included)
  let prompt = BASE_PROMPT;

  // Layer 2: Context-specific instructions
  prompt += "\n\n" + CONTEXT_PROMPTS[context];

  // Layer 3: Live context data (pre-fetched)
  const contextData = await getContextData(orgId, context);
  prompt += contextData;

  // Layer 4: Custom user instructions + vocabulary
  const customInstructions = await getCustomInstructions(orgId, context);
  if (customInstructions) prompt += customInstructions;

  // Layer 5: Past mistakes (auto-learning from negative feedback)
  const mistakes = await getRecentMistakes(orgId, context);
  if (mistakes) prompt += mistakes;

  return prompt;
}

async function getCustomInstructions(orgId: string, context: AgentContext): Promise<string> {
  try {
    const prompts = await prisma.aiCustomPrompt.findMany({
      where: {
        orgId,
        isActive: true,
        type: { in: ["instruction", "alias", "memory"] },
        OR: [
          { context: null },
          { context },
        ],
      },
      orderBy: { sortOrder: "asc" },
      take: 50,
    });

    if (prompts.length === 0) return "";

    const instructions = prompts.filter(p => p.type === "instruction").map(p => `- ${p.content}`);
    const aliases = prompts.filter(p => p.type === "alias").map(p => `- "${p.name}" means: ${p.content}`);
    const memories = prompts.filter(p => p.type === "memory").slice(-20).map(p => `- ${p.content}`);

    let result = "\n\nCUSTOM INSTRUCTIONS (set by this organization's admin):";
    if (instructions.length > 0) result += "\n" + instructions.join("\n");
    if (aliases.length > 0) result += "\n\nVOCABULARY:\n" + aliases.join("\n");
    if (memories.length > 0) result += "\n\nRECENT AGENT ACTIONS (for context):\n" + memories.join("\n");
    return result;
  } catch {
    // Table might not exist yet if migration hasn't run
    return "";
  }
}

async function getRecentMistakes(orgId: string, context: AgentContext): Promise<string> {
  try {
    const negatives = await prisma.aiChatFeedback.findMany({
      where: {
        orgId,
        rating: "negative",
        feedback: { not: null },
        ...(context !== "global" ? { context } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { userMessage: true, feedback: true },
    });

    if (negatives.length === 0) return "";

    const mistakes = negatives.map(
      (n) =>
        `- User asked: "${n.userMessage.slice(0, 100)}" → Problem: ${n.feedback}`
    );

    return `\n\nPAST MISTAKES TO AVOID (based on user feedback):
${mistakes.join("\n")}
Learn from these mistakes. If a similar request comes up, adjust your approach accordingly.`;
  } catch {
    return "";
  }
}
