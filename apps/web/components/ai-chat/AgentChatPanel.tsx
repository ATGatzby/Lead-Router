"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BrainCircuit,
  X,
  Send,
  Mic,
  MicOff,
  Plus,
  Settings2,
  ArrowRight,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PaywallOverlay } from "./PaywallOverlay";
import { SuggestionGrid } from "./SuggestionGrid";
import { MessageBubble } from "./MessageBubble";
import { AgentActivityTab } from "./AgentActivityTab";
import { CONTEXT_SUGGESTIONS } from "./ContextSuggestions";
import type { AgentContext } from "@/lib/ai/contexts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AgentChatPanelProps {
  context: AgentContext;
  entityId?: string;
  onMutationComplete?: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Context-aware titles
// ---------------------------------------------------------------------------

const CONTEXT_TITLES: Record<AgentContext, string> = {
  "license-users": "AI License Manager",
  teams: "AI Team Manager",
  "routing-rules": "AI Rule Manager",
  global: "AI Assistant",
};

const CONTEXT_PLACEHOLDERS: Record<AgentContext, string> = {
  "license-users": "Ask about users and licenses...",
  teams: "Ask about teams and members...",
  "routing-rules": "Ask about routing rules...",
  global: "Ask about your routing data...",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentChatPanel({
  context,
  entityId,
  onMutationComplete,
  onClose,
}: AgentChatPanelProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "activity">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Voice input
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const supportsVoice =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // -------------------------------------------------------------------------
  // License check
  // -------------------------------------------------------------------------

  const licenseQuery = useQuery({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license");
      if (!res.ok) return { tier: "free", hasAiKey: false, aiProvider: null };
      return res.json();
    },
  });

  const isFreeTier = (licenseQuery.data?.tier ?? "free") === "free";
  const hasAiKey = licenseQuery.data?.hasAiKey ?? false;
  const aiProvider: string | null = licenseQuery.data?.aiProvider ?? null;

  // -------------------------------------------------------------------------
  // Escape key to close
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // -------------------------------------------------------------------------
  // Auto-scroll
  // -------------------------------------------------------------------------

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // -------------------------------------------------------------------------
  // Focus textarea when panel opens
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (activeTab === "chat" && hasAiKey && !isFreeTier) {
      // Small delay to allow slide-in animation
      const timer = setTimeout(() => textareaRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [activeTab, hasAiKey, isFreeTier]);

  // -------------------------------------------------------------------------
  // Voice input
  // -------------------------------------------------------------------------

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  // -------------------------------------------------------------------------
  // Chat mutation
  // -------------------------------------------------------------------------

  const chatMutation = useMutation({
    mutationFn: async (newMessages: ChatMessage[]) => {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          context,
          entityId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Chat request failed" }));
        throw new Error(data.error ?? "Chat request failed");
      }
      return res.json() as Promise<{ role: "assistant"; content: string }>;
    },
    onSuccess: (data, variables) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content },
      ]);

      // Detect mutation completion: if the last user message was a confirmation
      // and the AI responded (presumably with success), notify the parent.
      const lastUserMsg = variables[variables.length - 1];
      if (lastUserMsg?.role === "user") {
        const text = lastUserMsg.content.toLowerCase().trim();
        const isConfirmation =
          text === "yes, proceed" ||
          text === "yes" ||
          text === "confirm" ||
          text.startsWith("yes,") ||
          text.startsWith("yes ");
        if (isConfirmation) {
          onMutationComplete?.();
        }
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(
    (text?: string) => {
      const msg = text ?? input.trim();
      if (!msg || chatMutation.isPending) return;

      // Stop voice if active
      if (isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
      }

      const userMessage: ChatMessage = { role: "user", content: msg };
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setInput("");

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      chatMutation.mutate(newMessages);
    },
    [input, chatMutation, messages, isListening],
  );

  // -------------------------------------------------------------------------
  // Confirmation / Cancel handlers for ConfirmationCard
  // -------------------------------------------------------------------------

  const handleConfirm = useCallback(() => {
    sendMessage("Yes, proceed");
  }, [sendMessage]);

  const handleCancel = useCallback(() => {
    sendMessage("Cancel that");
  }, [sendMessage]);

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const isEmpty = messages.length === 0;
  const title = CONTEXT_TITLES[context];
  const placeholder = CONTEXT_PLACEHOLDERS[context];
  const suggestions = CONTEXT_SUGGESTIONS[context];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed top-0 right-0 bottom-0 z-50 flex flex-col",
          "w-full max-w-[500px]",
          "border-l border-violet-500/20",
          "bg-white dark:bg-[#12121a]",
          "shadow-2xl shadow-violet-500/10",
          "animate-in slide-in-from-right duration-300",
        )}
      >
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-violet-500/20 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
              <BrainCircuit className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold truncate">{title}</h3>
                <span className="shrink-0 rounded-md bg-gradient-to-r from-violet-600 to-purple-500 dark:from-violet-500 dark:to-purple-400 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide text-white">
                  Pro
                </span>
              </div>
              {entityId && (
                <p className="text-[11px] text-muted-foreground truncate">
                  Focused on {context === "teams" ? "team" : context === "routing-rules" ? "rule" : "entity"} {entityId.slice(0, 8)}...
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* ---- Tabs ---- */}
        <div className="flex border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={cn(
              "flex-1 py-2.5 text-xs font-medium transition-colors relative",
              activeTab === "chat"
                ? "text-violet-600 dark:text-violet-400"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Chat
            {activeTab === "chat" && (
              <span className="absolute bottom-0 inset-x-4 h-0.5 rounded-full bg-violet-600 dark:bg-violet-400" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("activity")}
            className={cn(
              "flex-1 py-2.5 text-xs font-medium transition-colors relative",
              activeTab === "activity"
                ? "text-violet-600 dark:text-violet-400"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Activity
            {activeTab === "activity" && (
              <span className="absolute bottom-0 inset-x-4 h-0.5 rounded-full bg-violet-600 dark:bg-violet-400" />
            )}
          </button>
        </div>

        {/* ---- Body ---- */}
        {activeTab === "activity" ? (
          <div className="flex-1 overflow-hidden">
            <AgentActivityTab context={context} />
          </div>
        ) : (
          <>
            {/* License paywall */}
            {isFreeTier ? (
              <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden">
                <PaywallOverlay />
              </div>
            ) : !hasAiKey ? (
              /* No AI key configured */
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
                  <Settings2 className="h-7 w-7 text-violet-600 dark:text-violet-400" />
                </div>
                <h2 className="text-base font-semibold">Connect an AI Provider</h2>
                <p className="max-w-xs text-center text-sm text-muted-foreground leading-relaxed">
                  To use the {title}, connect your LLM provider (Claude, OpenAI,
                  Gemini, or a custom endpoint) in settings.
                </p>
                <Link
                  href="/settings/ai"
                  className="mt-1 inline-flex items-center gap-2 rounded-lg bg-violet-600 dark:bg-violet-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 dark:hover:bg-violet-600"
                >
                  Go to AI Settings
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              /* Chat content */
              <>
                {/* Messages area */}
                <div className="flex-1 overflow-y-auto px-4">
                  {isEmpty ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-14 px-2">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
                        <BrainCircuit className="h-7 w-7 text-violet-600 dark:text-violet-400" />
                      </div>
                      <h2 className="text-base font-semibold text-center">
                        {context === "global"
                          ? "Ask anything about your routing data"
                          : `Manage your ${context === "license-users" ? "licenses" : context === "teams" ? "teams" : "rules"} with AI`}
                      </h2>
                      <p className="max-w-xs text-center text-sm text-muted-foreground leading-relaxed">
                        {context === "license-users"
                          ? "License users, check seat usage, and manage access with natural language."
                          : context === "teams"
                            ? "Create teams, add members, adjust weights, and manage distribution."
                            : context === "routing-rules"
                              ? "Create rules, add conditions, configure assignments, and optimize routing."
                              : "Query performance, analyze teams, manage rules, and optimize routing."}
                      </p>
                      <SuggestionGrid
                        onSelect={sendMessage}
                        suggestions={suggestions}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 py-4">
                      {messages.map((msg, i) => (
                        <MessageBubble
                          key={i}
                          role={msg.role}
                          content={msg.content}
                          context={context}
                          onConfirm={handleConfirm}
                          onCancel={handleCancel}
                          userMessage={
                            msg.role === "assistant" && i > 0
                              ? messages[i - 1]?.content
                              : undefined
                          }
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

                {/* Input area */}
                <div className="border-t px-4 py-3 shrink-0">
                  <div
                    className={cn(
                      "flex items-end gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm transition",
                      "focus-within:border-violet-500 dark:focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/10 dark:focus-within:ring-violet-400/10",
                      isListening && "border-red-500/50 ring-2 ring-red-500/10",
                    )}
                  >
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height =
                          Math.min(e.target.scrollHeight, 100) + "px";
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        isListening ? "Listening..." : placeholder
                      }
                      className="flex-1 resize-none border-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                      style={{ minHeight: "24px", maxHeight: "100px" }}
                    />

                    {/* Voice input button */}
                    {supportsVoice && (
                      <button
                        type="button"
                        onClick={toggleVoice}
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                          isListening
                            ? "bg-red-500/20 text-red-500 animate-pulse"
                            : "text-muted-foreground hover:text-violet-500 hover:bg-violet-500/10",
                        )}
                        title={isListening ? "Stop listening" : "Voice input"}
                      >
                        {isListening ? (
                          <MicOff className="h-4 w-4" />
                        ) : (
                          <Mic className="h-4 w-4" />
                        )}
                      </button>
                    )}

                    {/* Send button */}
                    <button
                      type="button"
                      onClick={() => sendMessage()}
                      disabled={!input.trim() || chatMutation.isPending}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 dark:bg-violet-500 text-white transition hover:bg-violet-700 dark:hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {chatMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {/* Footer hints */}
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground px-1">
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />
                      Querying your org&apos;s data only
                    </div>
                    <span>Shift+Enter for new line</span>
                  </div>

                  {/* New chat button when messages exist */}
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMessages([])}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New conversation
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
