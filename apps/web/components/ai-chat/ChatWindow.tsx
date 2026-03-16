"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrainCircuit, Plus, Send, Settings2, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PaywallOverlay } from "./PaywallOverlay";
import { SuggestionGrid } from "./SuggestionGrid";
import { MessageBubble } from "./MessageBubble";
import { CONTEXT_SUGGESTIONS } from "./ContextSuggestions";
import type { AgentContext } from "@/lib/ai/contexts";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatWindowProps {
  plan: string;
  hasAiKey: boolean;
  aiProvider: string | null;
  aiModelName: string | null;
  context?: string;
}

export function ChatWindow({ plan, hasAiKey, aiProvider, aiModelName, context = "global" }: ChatWindowProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const chatMutation = useMutation({
    mutationFn: async (newMessages: ChatMessage[]) => {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, context }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Chat request failed");
      }
      return res.json() as Promise<{ role: "assistant"; content: string }>;
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const sendMessage = (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || chatMutation.isPending) return;

    const userMessage: ChatMessage = { role: "user", content: msg };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    chatMutation.mutate(newMessages);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Plan gate — show dummy conversation behind paywall to entice upgrade
  if (plan !== "PAID") {
    return (
      <div className="relative flex flex-1 flex-col min-h-[60vh] overflow-hidden">
        <PaywallOverlay />
        {/* Dummy chat preview behind the overlay */}
        <div className="pointer-events-none select-none blur-[3px] opacity-40 flex flex-1 flex-col">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">AI Assistant</h1>
              <span className="rounded-md bg-gradient-to-r from-violet-600 to-purple-500 dark:from-violet-500 dark:to-purple-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Pro
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-hidden px-6">
            <div className="mx-auto max-w-3xl flex flex-col gap-5 pb-4">
              {/* Dummy user message */}
              <div className="flex justify-end">
                <div className="rounded-xl bg-violet-600 dark:bg-violet-500 px-4 py-3 text-sm text-white max-w-md">
                  Show me routing performance for the last 30 days
                </div>
              </div>
              {/* Dummy assistant message with inline chart */}
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 dark:from-violet-500 dark:to-purple-400 text-white">
                  <BrainCircuit className="h-3.5 w-3.5" />
                </div>
                <div className="rounded-xl border bg-card px-4 py-3 text-sm max-w-xl space-y-3">
                  <p>Here&apos;s your routing summary for the last 30 days:</p>
                  {/* Mini KPI row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-violet-50 dark:bg-violet-950 p-2 text-center">
                      <div className="text-lg font-bold text-violet-700 dark:text-violet-300">2,847</div>
                      <div className="text-[10px] text-muted-foreground">Routed</div>
                    </div>
                    <div className="rounded-lg bg-green-50 dark:bg-green-950 p-2 text-center">
                      <div className="text-lg font-bold text-green-700 dark:text-green-300">94.2%</div>
                      <div className="text-[10px] text-muted-foreground">Success</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950 p-2 text-center">
                      <div className="text-lg font-bold text-blue-700 dark:text-blue-300">4.8s</div>
                      <div className="text-[10px] text-muted-foreground">Avg Speed</div>
                    </div>
                  </div>
                  {/* Mini bar chart */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Top Rules</p>
                    {[
                      { name: "New Lead → Eastern Team", w: "85%", v: 842 },
                      { name: "Enterprise Accounts", w: "64%", v: 631 },
                      { name: "Web Inbound → SDR Pool", w: "53%", v: 524 },
                      { name: "Partner Referrals", w: "42%", v: 412 },
                    ].map((r) => (
                      <div key={r.name} className="flex items-center gap-2 text-xs">
                        <span className="w-36 truncate text-muted-foreground">{r.name}</span>
                        <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500" style={{ width: r.w }} />
                        </div>
                        <span className="text-[10px] font-mono w-8 text-right">{r.v}</span>
                      </div>
                    ))}
                  </div>
                  <p>Conversion rate improved by <strong>+5.7%</strong> this period.</p>
                </div>
              </div>
              {/* Dummy user follow-up */}
              <div className="flex justify-end">
                <div className="rounded-xl bg-violet-600 dark:bg-violet-500 px-4 py-3 text-sm text-white max-w-md">
                  Which team has the highest conversion rate?
                </div>
              </div>
              {/* Dummy assistant response with team table */}
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 dark:from-violet-500 dark:to-purple-400 text-white">
                  <BrainCircuit className="h-3.5 w-3.5" />
                </div>
                <div className="rounded-xl border bg-card px-4 py-3 text-sm max-w-xl space-y-3">
                  <p>Here are your team conversion rates:</p>
                  <div className="rounded-lg border overflow-hidden text-xs">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-3 py-1.5 font-medium">Team</th>
                          <th className="text-right px-3 py-1.5 font-medium">Conv. Rate</th>
                          <th className="text-right px-3 py-1.5 font-medium">Leads</th>
                          <th className="text-right px-3 py-1.5 font-medium">Speed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { team: "Enterprise West", rate: "31.4%", leads: 412, speed: "3.2s" },
                          { team: "SDR Pool", rate: "26.8%", leads: 524, speed: "5.1s" },
                          { team: "Eastern Team", rate: "24.1%", leads: 842, speed: "4.3s" },
                          { team: "APAC Region", rate: "19.7%", leads: 289, speed: "6.8s" },
                        ].map((t) => (
                          <tr key={t.team} className="border-t">
                            <td className="px-3 py-1.5">{t.team}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{t.rate}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{t.leads}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{t.speed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p><strong>Enterprise West</strong> leads with 31.4% conversion and the fastest speed-to-lead at 3.2s.</p>
                </div>
              </div>
            </div>
          </div>
          {/* Dummy input area */}
          <div className="border-t px-6 py-4">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-end gap-2 rounded-2xl border bg-card px-4 py-2 shadow-sm">
                <div className="flex-1 text-sm text-muted-foreground py-1">Ask about your routing data...</div>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600/40 text-white">
                  <Send className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No API key — guide to settings
  if (!hasAiKey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
          <Settings2 className="h-8 w-8 text-violet-600 dark:text-violet-400" />
        </div>
        <h2 className="text-lg font-semibold">Connect an AI Provider</h2>
        <p className="max-w-sm text-center text-sm text-muted-foreground leading-relaxed">
          To use the AI Assistant, connect your LLM provider (Claude, OpenAI, Gemini, or a custom endpoint) in settings.
        </p>
        <Link
          href="/settings/ai"
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-violet-600 dark:bg-violet-500 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 dark:hover:bg-violet-600"
        >
          Go to AI Settings
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">AI Assistant</h1>
          <span className="rounded-md bg-gradient-to-r from-violet-600 to-purple-500 dark:from-violet-500 dark:to-purple-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Pro
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/ai"
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="AI Settings"
          >
            <Settings2 className="h-3 w-3" />
            {aiProvider === "claude" ? "Claude" : aiProvider === "openai" ? "OpenAI" : aiProvider === "gemini" ? "Gemini" : "Custom"}
            {aiModelName && ` · ${aiModelName}`}
          </Link>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto max-w-3xl">
          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
                <BrainCircuit className="h-8 w-8 text-violet-600 dark:text-violet-400" />
              </div>
              <h2 className="text-lg font-semibold">Ask anything about your routing data</h2>
              <p className="max-w-md text-center text-sm text-muted-foreground leading-relaxed">
                Query your lead routing performance, analyze team workload, get conversion insights, and understand your rules — all in natural language.
              </p>
              <SuggestionGrid onSelect={sendMessage} suggestions={CONTEXT_SUGGESTIONS[(context as AgentContext) ?? "global"]} />
            </div>
          ) : (
            <div className="flex flex-col gap-5 pb-4">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  role={msg.role}
                  content={msg.content}
                />
              ))}
              {chatMutation.isPending && (
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 dark:from-violet-500 dark:to-purple-400 text-white">
                    <BrainCircuit className="h-3.5 w-3.5" />
                  </div>
                  <div className="rounded-xl border bg-card px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 dark:bg-violet-400 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 dark:bg-violet-400 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500 dark:bg-violet-400 [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className={cn(
            "flex items-end gap-2 rounded-2xl border bg-card px-4 py-2 shadow-sm transition",
            "focus-within:border-violet-500 dark:focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/10 dark:focus-within:ring-violet-400/10"
          )}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your routing data..."
              className="flex-1 resize-none border-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
              style={{ minHeight: "24px", maxHeight: "120px" }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || chatMutation.isPending}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 dark:bg-violet-500 text-white transition hover:bg-violet-700 dark:hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />
              Querying your org&apos;s data only
            </div>
            <span>Shift+Enter for new line</span>
          </div>
        </div>
      </div>
    </div>
  );
}
