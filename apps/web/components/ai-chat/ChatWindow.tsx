"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrainCircuit, Plus, Send, Settings2, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
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
