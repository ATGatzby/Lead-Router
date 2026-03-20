"use client";

import { useQuery } from "@tanstack/react-query";
import { BrainCircuit } from "lucide-react";
import { PromptEditor } from "@/components/ai-chat/PromptEditor";

export default function PromptsPage() {
  const { data: license } = useQuery<{ tier: string }>({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license");
      if (!res.ok) throw new Error("Failed to load license");
      return res.json();
    },
  });

  const isFree = !license || license.tier === "free";

  if (isFree) {
    return (
      <div className="relative max-w-3xl min-h-[60vh]">
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto max-w-sm text-center px-8 py-8 rounded-2xl bg-white dark:bg-gray-900 border shadow-2xl shadow-violet-500/10">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
              <BrainCircuit className="h-7 w-7 text-violet-600 dark:text-violet-400" />
            </div>
            <h3 className="text-lg font-semibold mb-2">AI Prompts require Pro</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
              Customize how your AI assistant behaves with custom instructions, vocabulary, and templates.
            </p>
            <a
              href="https://openedgeai.tech/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 dark:from-violet-500 dark:to-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/40"
            >
              <BrainCircuit className="h-4 w-4" />
              Upgrade to Pro
            </a>
          </div>
        </div>
        <div className="pointer-events-none select-none blur-[3px] opacity-40 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Prompt Engineering</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Customize how your AI assistant behaves with custom instructions, vocabulary, and templates.
            </p>
          </div>
          <div className="rounded-xl border bg-card h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Prompt Engineering</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize how your AI assistant behaves with custom instructions, vocabulary, and templates.
        </p>
      </div>
      <PromptEditor />
    </div>
  );
}
