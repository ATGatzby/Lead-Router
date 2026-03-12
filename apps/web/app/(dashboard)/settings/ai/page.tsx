"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  BrainCircuit,
  Check,
  Lock,
  Pencil,
  Plus,
  Settings2,
  Unplug,
  Zap,
  X,
  ArrowRight,
} from "lucide-react";

type Provider = "claude" | "openai" | "gemini" | "custom";

interface ProviderConfig {
  id: Provider;
  name: string;
  shortName: string;
  description: string;
  tag?: string;
  tagColor?: string;
  color: string;
  activeColor: string;
  dotColor: string;
  keyPlaceholder: string;
  models: { value: string; label: string }[];
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: "claude",
    name: "Anthropic (Claude)",
    shortName: "Claude",
    description: "Advanced reasoning & analysis with best tool-use accuracy.",
    tag: "Recommended",
    tagColor: "bg-green-100 text-green-800",
    color: "bg-amber-50",
    activeColor: "border-amber-400",
    dotColor: "bg-amber-500",
    keyPlaceholder: "sk-ant-api03-...",
    models: [
      { value: "claude-sonnet-4-5-20250514", label: "Claude Sonnet 4.5" },
      { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    shortName: "OpenAI",
    description: "GPT-4o for balanced performance. Compatible with Azure OpenAI.",
    tag: "Popular",
    tagColor: "bg-indigo-100 text-indigo-800",
    color: "bg-green-50",
    activeColor: "border-green-400",
    dotColor: "bg-green-500",
    keyPlaceholder: "sk-proj-...",
    models: [
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o mini" },
      { value: "o3-mini", label: "o3-mini" },
    ],
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    shortName: "Gemini",
    description: "Gemini 2.5 with 1M token context window.",
    color: "bg-blue-50",
    activeColor: "border-blue-400",
    dotColor: "bg-blue-500",
    keyPlaceholder: "AIzaSy...",
    models: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    ],
  },
  {
    id: "custom",
    name: "Custom / Self-Hosted",
    shortName: "Custom",
    description: "Any OpenAI-compatible API — Ollama, Together AI, Groq.",
    color: "bg-violet-50",
    activeColor: "border-violet-400",
    dotColor: "bg-violet-500",
    keyPlaceholder: "your-api-key",
    models: [],
  },
];

function getProvider(id: string): ProviderConfig {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[3];
}

export default function AiSettingsPage() {
  // Fetch current config
  const { data: config, refetch } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings/ai");
      if (!res.ok) throw new Error("Failed to fetch AI settings");
      return res.json() as Promise<{
        provider: string | null;
        model: string | null;
        baseUrl: string | null;
        customHeaders: Record<string, string> | null;
        hasKey: boolean;
        chatCount: number;
      }>;
    },
    staleTime: 30_000,
  });

  // Modal state
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customHeaders, setCustomHeaders] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);

  const isConnected = config?.hasKey && config?.provider;
  const connectedProvider = config?.provider ?? null;

  // Reset form when opening modal
  function openEditModal(providerId: Provider) {
    const prov = getProvider(providerId);
    setEditingProvider(providerId);
    setApiKey("");
    setModel(providerId === connectedProvider && config?.model ? config.model : prov.models[0]?.value ?? "");
    setBaseUrl(providerId === connectedProvider && config?.baseUrl ? config.baseUrl : "");
    setCustomModel(providerId === connectedProvider && config?.model && providerId === "custom" ? config.model : "");
    setCustomHeaders(
      providerId === connectedProvider && config?.customHeaders
        ? JSON.stringify(config.customHeaders)
        : ""
    );
    setTestResult(null);
  }

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const prov = editingProvider!;
      const payload: Record<string, unknown> = {
        provider: prov,
        model: prov === "custom" ? customModel : model,
      };
      if (apiKey) payload.apiKey = apiKey;
      if (prov === "custom") {
        if (baseUrl) payload.baseUrl = baseUrl;
        if (customHeaders) payload.customHeaders = JSON.parse(customHeaders);
      }
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success(`${getProvider(editingProvider!).shortName} connected successfully`);
      setEditingProvider(null);
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Test mutation
  const testMutation = useMutation({
    mutationFn: async () => {
      const prov = editingProvider!;
      const res = await fetch("/api/settings/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: prov,
          apiKey: apiKey || undefined,
          model: prov === "custom" ? customModel : model,
          baseUrl: prov === "custom" ? baseUrl : undefined,
        }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      setTestResult(data.ok ? { ok: true, latencyMs: data.latencyMs } : { ok: false, error: data.error ?? "Test failed" });
    },
    onError: (err: Error) => setTestResult({ ok: false, error: err.message }),
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: null, apiKey: "", model: null, baseUrl: null }),
      });
      if (!res.ok) throw new Error("Disconnect failed");
    },
    onSuccess: () => {
      toast.success("AI provider disconnected");
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const editProv = editingProvider ? getProvider(editingProvider) : null;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground">
          Connect an LLM provider to power the AI routing assistant. Your API key is encrypted and stored on your server.
        </p>
      </div>

      {/* Active Provider Banner */}
      {isConnected && connectedProvider && (
        <div className="flex items-center justify-between rounded-lg border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 shadow-sm">
              <BrainCircuit className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Active Provider
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className={cn("h-2 w-2 rounded-full", getProvider(connectedProvider).dotColor)} />
                {getProvider(connectedProvider).shortName}
                {config?.model && (
                  <span className="font-normal text-muted-foreground">· {config.model}</span>
                )}
              </div>
            </div>
          </div>
          <a
            href="/ai-assistant"
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Open Chat
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {/* Provider Cards */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">Providers</h2>
        <div className="grid grid-cols-2 gap-4">
          {PROVIDERS.map((prov) => {
            const isActive = connectedProvider === prov.id && isConnected;
            return (
              <div
                key={prov.id}
                className={cn(
                  "relative rounded-xl border bg-card p-5 transition hover:shadow-md",
                  isActive
                    ? cn("border-2", prov.activeColor)
                    : "hover:border-violet-300"
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", prov.color)}>
                      <Settings2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{prov.shortName}</span>
                        {prov.tag && (
                          <span className={cn("text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5", prov.tagColor)}>
                            {prov.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{prov.description}</p>
                    </div>
                  </div>
                </div>

                {/* Status */}
                {isActive ? (
                  <>
                    <div className="flex items-center gap-1.5 mb-3">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs font-medium text-green-700">Connected</span>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 mb-4 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Model</span>
                        <span className="font-mono font-medium">{config?.model ?? "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">API Key</span>
                        <span className="font-mono font-medium">•••• configured</span>
                      </div>
                      {config?.baseUrl && prov.id === "custom" && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Endpoint</span>
                          <span className="font-mono font-medium text-[11px] truncate max-w-[140px]">{config.baseUrl}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(prov.id)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition hover:bg-muted"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => disconnectMutation.mutate()}
                        disabled={disconnectMutation.isPending}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100"
                      >
                        <Unplug className="h-3 w-3" />
                        Disconnect
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => openEditModal(prov.id)}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 px-3 py-2.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 hover:border-violet-400"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Connect {prov.shortName}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Usage Stats */}
      <div className="rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Usage</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="text-2xl font-bold tracking-tight">{config?.chatCount?.toLocaleString() ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Total conversations</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="text-2xl font-bold tracking-tight">{isConnected ? "1" : "0"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Active provider</div>
          </div>
        </div>
      </div>

      {/* Security Note */}
      <div className="flex items-start gap-2.5 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <p className="text-xs text-green-800 leading-relaxed">
          <strong>Your key stays on your server.</strong> Encrypted with AES-256-GCM using your APP_SECRET.
          API calls go directly from your server to the provider — never through a third party.
        </p>
      </div>

      {/* ─── Edit/Connect Modal ──────────────────────────── */}
      {editingProvider && editProv && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingProvider(null); }}
        >
          <div className="w-full max-w-md rounded-xl border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div className="flex items-center gap-3">
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", editProv.color)}>
                  <Settings2 className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">
                    {connectedProvider === editingProvider && isConnected ? "Edit" : "Connect"} {editProv.shortName}
                  </h3>
                  <p className="text-xs text-muted-foreground">{editProv.name}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingProvider(null)}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-4">
              {/* API Key */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editProv.keyPlaceholder}
                  className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
                {connectedProvider === editingProvider && isConnected && (
                  <p className="text-[11px] text-muted-foreground">Leave blank to keep existing key.</p>
                )}
              </div>

              {/* Model */}
              {editProv.models.length > 0 ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  >
                    {editProv.models.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
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
              )}

              {/* Custom-only fields */}
              {editingProvider === "custom" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Base URL</label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
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

              {/* Test Result */}
              {testResult && (
                <div className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium",
                  testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                )}>
                  {testResult.ok ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Connection successful — {testResult.latencyMs}ms
                    </>
                  ) : (
                    <>
                      <X className="h-3.5 w-3.5" />
                      {testResult.error}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t px-6 py-4">
              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || (!apiKey && !(connectedProvider === editingProvider && isConnected))}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {testMutation.isPending ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3" />
                    Test Connection
                  </>
                )}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingProvider(null)}
                  className="rounded-lg border px-4 py-2 text-xs font-medium transition hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || (!apiKey && !(connectedProvider === editingProvider && isConnected))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saveMutation.isPending ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Saving...
                    </>
                  ) : (
                    <>Save & Connect</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
