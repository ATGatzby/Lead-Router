"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, Lock, Settings, ArrowRight } from "lucide-react";

type Provider = "claude" | "openai" | "gemini" | "custom";

interface ProviderOption {
  id: Provider;
  name: string;
  description: string;
  tag?: string;
  tagColor?: string;
  color: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: "claude",
    name: "Anthropic (Claude)",
    description: "Claude Sonnet 4.5 for fast queries, Opus 4 for deep analysis. Best tool-use accuracy.",
    tag: "Recommended",
    tagColor: "bg-green-100 text-green-800",
    color: "bg-amber-50",
  },
  {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    description: "GPT-4o for balanced performance, o1 for reasoning. Compatible with Azure OpenAI.",
    tag: "Popular",
    tagColor: "bg-indigo-100 text-indigo-800",
    color: "bg-green-50",
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    description: "Gemini 2.5 Pro for complex analysis, Flash for fast queries. 1M token context.",
    color: "bg-blue-50",
  },
  {
    id: "custom",
    name: "Custom / Self-Hosted",
    description: "Any OpenAI-compatible API — Ollama, LiteLLM, vLLM, Together AI, Groq.",
    color: "bg-muted",
  },
];

const MODEL_OPTIONS: Record<Provider, { value: string; label: string }[]> = {
  claude: [
    { value: "claude-sonnet-4-5-20250514", label: "Claude Sonnet 4.5 (Recommended)" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4 (Deep analysis)" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (Fastest)" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o (Recommended)" },
    { value: "gpt-4o-mini", label: "GPT-4o mini (Fastest)" },
    { value: "o1", label: "o1 (Complex reasoning)" },
  ],
  gemini: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Recommended)" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fastest)" },
  ],
  custom: [],
};

interface ConnectProviderProps {
  onConnected: () => void;
}

export function ConnectProvider({ onConnected }: ConnectProviderProps) {
  const [provider, setProvider] = useState<Provider>("claude");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODEL_OPTIONS.claude[0].value);
  const [baseUrl, setBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customHeaders, setCustomHeaders] = useState("");
  const [success, setSuccess] = useState<{ latencyMs: number } | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Save config
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey,
          model: provider === "custom" ? customModel : model,
          baseUrl: provider === "custom" ? baseUrl : undefined,
          customHeaders: customHeaders ? JSON.parse(customHeaders) : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");

      // Test connection
      const testRes = await fetch("/api/settings/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey,
          model: provider === "custom" ? customModel : model,
          baseUrl: provider === "custom" ? baseUrl : undefined,
        }),
      });
      const testData = await testRes.json();
      if (!testData.ok) throw new Error(testData.error ?? "Connection test failed");
      return testData;
    },
    onSuccess: (data) => {
      setSuccess({ latencyMs: data.latencyMs });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (success) {
    const providerName = PROVIDERS.find((p) => p.id === provider)?.name ?? provider;
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <Check className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="text-base font-semibold">Connected to {providerName}</h3>
          <p className="text-sm text-muted-foreground">
            Responded in {success.latencyMs}ms. Your AI Assistant is ready.
          </p>
          <button
            onClick={onConnected}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Start chatting
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto py-10">
      <div className="w-full max-w-lg">
        <h2 className="text-xl font-semibold mb-1.5">Connect your AI provider</h2>
        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
          Bring your own API key to power the AI Routing Assistant. Your key is encrypted and stored on your server.
        </p>

        {/* Provider cards */}
        <div className="flex flex-col gap-3 mb-8">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setProvider(p.id);
                setModel(MODEL_OPTIONS[p.id]?.[0]?.value ?? "");
              }}
              className={cn(
                "flex items-center gap-3.5 rounded-xl border-2 p-4 text-left transition",
                provider === p.id
                  ? "border-violet-500 bg-violet-50/50 shadow-sm shadow-violet-500/10"
                  : "border-border hover:border-violet-300 hover:bg-violet-50/30"
              )}
            >
              <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", p.color)}>
                <Settings className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {p.name}
                  {p.tag && (
                    <span className={cn("text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5", p.tagColor)}>
                      {p.tag}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground leading-snug mt-0.5">{p.description}</div>
              </div>
              <div className={cn(
                "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 transition",
                provider === p.id ? "border-violet-500" : "border-border"
              )}>
                {provider === p.id && <div className="h-2 w-2 rounded-full bg-violet-500" />}
              </div>
            </button>
          ))}
        </div>

        {/* Config form */}
        <div className="rounded-xl border bg-card p-5 space-y-4 mb-6">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === "claude" ? "sk-ant-api03-..." : provider === "openai" ? "sk-proj-..." : provider === "gemini" ? "AIza..." : "your-api-key"}
              className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>

          {provider !== "custom" && MODEL_OPTIONS[provider].length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              >
                {MODEL_OPTIONS[provider].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          )}

          {provider === "custom" && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.your-provider.com/v1"
                  className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Model Name</label>
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="e.g., llama-3.1-70b"
                  className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Custom Headers <span className="font-normal text-muted-foreground">(optional, JSON)</span>
                </label>
                <input
                  type="text"
                  value={customHeaders}
                  onChange={(e) => setCustomHeaders(e.target.value)}
                  placeholder='{"X-Custom-Header": "value"}'
                  className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
              </div>
            </>
          )}
        </div>

        {/* Security note */}
        <div className="flex items-start gap-2.5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 mb-6">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          <p className="text-xs text-green-800 leading-relaxed">
            <strong>Your key stays on your server.</strong> It&apos;s encrypted with your APP_SECRET and stored in your self-hosted database. API calls go directly from your server to the provider.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!apiKey || saveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Testing...
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" />
                Test Connection & Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
