"use client";

import { cn } from "@/lib/utils";
import { BrainCircuit } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ChartBlock, { parseChartSpec } from "./ChartBlock";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; description?: string }[];
  userInitials?: string;
}

export function MessageBubble({ role, content, toolCalls, userInitials = "U" }: MessageBubbleProps) {
  return (
    <div className={cn("flex gap-3", role === "user" && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
          role === "assistant"
            ? "bg-gradient-to-br from-violet-600 to-purple-500 text-white"
            : "bg-primary text-primary-foreground"
        )}
      >
        {role === "assistant" ? (
          <BrainCircuit className="h-3.5 w-3.5" />
        ) : (
          userInitials
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "max-w-[680px] rounded-xl px-4 py-3 text-sm leading-relaxed",
          role === "assistant"
            ? "border bg-card"
            : "bg-primary text-primary-foreground"
        )}
      >
        {/* Tool call indicators */}
        {toolCalls?.map((tc) => (
          <div key={tc.name} className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Called <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{tc.name}</code>
            {tc.description && <span>— {tc.description}</span>}
          </div>
        ))}

        {/* Markdown content */}
        <div className="ai-markdown max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre({ children }) {
                // Check if the child is a chart block — if so, render without <pre> wrapper
                const child = children as any;
                if (child?.props?.className === "language-chart") {
                  const spec = parseChartSpec(String(child.props.children).trim());
                  if (spec) return <ChartBlock spec={spec} />;
                }
                return <pre>{children}</pre>;
              },
              code({ className, children, ...props }) {
                return <code className={className} {...props}>{children}</code>;
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
