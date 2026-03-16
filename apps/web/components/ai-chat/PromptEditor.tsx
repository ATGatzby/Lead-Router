"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Plus,
  Pencil,
  Trash2,
  BookOpen,
  MessageSquareText,
  BookMarked,
  Brain,
  ChevronRight,
  X,
  Copy,
} from "lucide-react";
import { BUILT_IN_TEMPLATES, type PromptTemplate } from "@/lib/ai/prompt-templates";

/* ── Types ──────────────────────────────────────────────── */

interface AiCustomPrompt {
  id: string;
  orgId: string;
  type: string;
  name: string;
  content: string;
  context: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

type TabId = "instructions" | "aliases" | "templates";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "instructions", label: "Custom Instructions", icon: <MessageSquareText className="h-4 w-4" /> },
  { id: "aliases", label: "Vocabulary & Aliases", icon: <BookMarked className="h-4 w-4" /> },
  { id: "templates", label: "Saved Templates", icon: <BookOpen className="h-4 w-4" /> },
];

/* ── Main Component ─────────────────────────────────────── */

export function PromptEditor() {
  const [activeTab, setActiveTab] = useState<TabId>("instructions");
  const [editingPrompt, setEditingPrompt] = useState<Partial<AiCustomPrompt> | null>(null);
  const [showBuiltIn, setShowBuiltIn] = useState(false);

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-prompts"],
    queryFn: async () => {
      const res = await fetch("/api/ai/prompts");
      if (!res.ok) throw new Error("Failed to fetch prompts");
      return res.json() as Promise<{ prompts: AiCustomPrompt[] }>;
    },
    staleTime: 30_000,
  });

  const prompts = data?.prompts ?? [];

  const instructions = prompts.filter((p) => p.type === "instruction");
  const aliases = prompts.filter((p) => p.type === "alias");
  const templates = prompts.filter((p) => p.type === "template");

  /* ── Mutations ──────────────────────────────────────── */

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ai/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Prompt created");
      queryClient.invalidateQueries({ queryKey: ["ai-prompts"] });
      setEditingPrompt(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ai/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Prompt updated");
      queryClient.invalidateQueries({ queryKey: ["ai-prompts"] });
      setEditingPrompt(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/ai/prompts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Prompt deleted");
      queryClient.invalidateQueries({ queryKey: ["ai-prompts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch("/api/ai/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Toggle failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-prompts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /* ── Helpers ────────────────────────────────────────── */

  function typeForTab(): string {
    if (activeTab === "instructions") return "instruction";
    if (activeTab === "aliases") return "alias";
    return "template";
  }

  function openCreate() {
    setEditingPrompt({ type: typeForTab(), name: "", content: "", context: null, isActive: true });
  }

  function openEdit(prompt: AiCustomPrompt) {
    setEditingPrompt({ ...prompt });
  }

  function handleSave() {
    if (!editingPrompt) return;
    if (!editingPrompt.name?.trim() || !editingPrompt.content?.trim()) {
      toast.error("Name and content are required");
      return;
    }
    if (editingPrompt.id) {
      updateMutation.mutate({
        id: editingPrompt.id,
        name: editingPrompt.name,
        content: editingPrompt.content,
        context: editingPrompt.context || null,
        isActive: editingPrompt.isActive,
      });
    } else {
      createMutation.mutate({
        type: editingPrompt.type,
        name: editingPrompt.name,
        content: editingPrompt.content,
        context: editingPrompt.context || null,
        isActive: editingPrompt.isActive ?? true,
      });
    }
  }

  function saveBuiltInAsTemplate(tmpl: PromptTemplate) {
    createMutation.mutate({
      type: "template",
      name: tmpl.name,
      content: tmpl.content,
      context: tmpl.context,
      isActive: true,
    });
  }

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="max-w-3xl space-y-6">
      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ── Instructions Tab ────────────────────── */}
          {activeTab === "instructions" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Custom instructions are injected into every AI conversation. Use them to set defaults, add context, or constrain behavior.
                </p>
                <button
                  onClick={openCreate}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 dark:bg-violet-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 dark:hover:bg-violet-600"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Instruction
                </button>
              </div>

              {instructions.length === 0 ? (
                <EmptyState
                  icon={<MessageSquareText className="h-8 w-8 text-muted-foreground/50" />}
                  title="No custom instructions yet"
                  description="Add instructions to customize how the AI responds. For example: 'Always refer to SDR team as Sales Development.'"
                  action={openCreate}
                  actionLabel="Add Instruction"
                />
              ) : (
                <div className="space-y-3">
                  {instructions.map((p) => (
                    <PromptCard
                      key={p.id}
                      prompt={p}
                      onEdit={() => openEdit(p)}
                      onDelete={() => deleteMutation.mutate(p.id)}
                      onToggle={() => toggleMutation.mutate({ id: p.id, isActive: !p.isActive })}
                      showToggle
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Aliases Tab ──────────────────────────── */}
          {activeTab === "aliases" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Teach the AI your team's vocabulary. Map shorthand names to their full meaning so the AI understands your jargon.
                </p>
                <button
                  onClick={openCreate}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 dark:bg-violet-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 dark:hover:bg-violet-600"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Alias
                </button>
              </div>

              {aliases.length === 0 ? (
                <EmptyState
                  icon={<BookMarked className="h-8 w-8 text-muted-foreground/50" />}
                  title="No vocabulary aliases yet"
                  description='Define aliases like "AE" = "Account Executive" or "MQL" = "Marketing Qualified Lead" so the AI speaks your language.'
                  action={openCreate}
                  actionLabel="Add Alias"
                />
              ) : (
                <div className="space-y-3">
                  {aliases.map((p) => (
                    <PromptCard
                      key={p.id}
                      prompt={p}
                      onEdit={() => openEdit(p)}
                      onDelete={() => deleteMutation.mutate(p.id)}
                      onToggle={() => toggleMutation.mutate({ id: p.id, isActive: !p.isActive })}
                      showToggle
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Templates Tab ────────────────────────── */}
          {activeTab === "templates" && (
            <div className="space-y-6">
              {/* User templates */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Save reusable prompts for common tasks. Templates appear in the AI chat as quick actions.
                  </p>
                  <button
                    onClick={openCreate}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 dark:bg-violet-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 dark:hover:bg-violet-600"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Template
                  </button>
                </div>

                {templates.length === 0 ? (
                  <EmptyState
                    icon={<BookOpen className="h-8 w-8 text-muted-foreground/50" />}
                    title="No saved templates yet"
                    description="Create your own templates or save one from the built-in library below."
                    action={openCreate}
                    actionLabel="Create Template"
                  />
                ) : (
                  <div className="space-y-3">
                    {templates.map((p) => (
                      <PromptCard
                        key={p.id}
                        prompt={p}
                        onEdit={() => openEdit(p)}
                        onDelete={() => deleteMutation.mutate(p.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Built-in library */}
              <div className="space-y-3">
                <button
                  onClick={() => setShowBuiltIn(!showBuiltIn)}
                  className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition"
                >
                  <ChevronRight
                    className={cn("h-4 w-4 transition-transform", showBuiltIn && "rotate-90")}
                  />
                  <Brain className="h-4 w-4" />
                  Built-in Template Library ({BUILT_IN_TEMPLATES.length})
                </button>

                {showBuiltIn && (
                  <div className="grid grid-cols-2 gap-3">
                    {BUILT_IN_TEMPLATES.map((tmpl) => (
                      <div
                        key={tmpl.id}
                        className="rounded-xl border bg-card p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="text-sm font-semibold">{tmpl.name}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {tmpl.description}
                            </p>
                          </div>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {tmpl.category}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {tmpl.content}
                        </p>
                        <button
                          onClick={() => saveBuiltInAsTemplate(tmpl)}
                          disabled={createMutation.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/50 px-2.5 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 transition hover:bg-violet-100 dark:hover:bg-violet-900"
                        >
                          <Copy className="h-3 w-3" />
                          Save to My Templates
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Edit/Create Modal ──────────────────────────── */}
      {editingPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditingPrompt(null);
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-base font-semibold">
                {editingPrompt.id ? "Edit" : "New"}{" "}
                {editingPrompt.type === "instruction"
                  ? "Instruction"
                  : editingPrompt.type === "alias"
                    ? "Alias"
                    : "Template"}
              </h3>
              <button
                onClick={() => setEditingPrompt(null)}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  {editingPrompt.type === "alias" ? "Term / Shorthand" : "Name"}
                </label>
                <input
                  type="text"
                  value={editingPrompt.name ?? ""}
                  onChange={(e) =>
                    setEditingPrompt((prev) => prev && { ...prev, name: e.target.value })
                  }
                  placeholder={
                    editingPrompt.type === "alias"
                      ? 'e.g., "AE", "MQL", "EMEA team"'
                      : editingPrompt.type === "instruction"
                        ? "e.g., Default timezone preference"
                        : "e.g., Weekly health check"
                  }
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  {editingPrompt.type === "alias" ? "Definition / Meaning" : "Content"}
                </label>
                <textarea
                  value={editingPrompt.content ?? ""}
                  onChange={(e) =>
                    setEditingPrompt((prev) => prev && { ...prev, content: e.target.value })
                  }
                  rows={editingPrompt.type === "template" ? 6 : 3}
                  placeholder={
                    editingPrompt.type === "alias"
                      ? 'e.g., "Account Executive — the sales rep who owns the deal"'
                      : editingPrompt.type === "instruction"
                        ? "e.g., Always show times in Pacific timezone unless asked otherwise"
                        : "Write the prompt that will be sent to the AI..."
                  }
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Context{" "}
                  <span className="font-normal text-muted-foreground">(optional — limit to a page)</span>
                </label>
                <select
                  value={editingPrompt.context ?? ""}
                  onChange={(e) =>
                    setEditingPrompt((prev) =>
                      prev && { ...prev, context: e.target.value || null }
                    )
                  }
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                >
                  <option value="">Global (all pages)</option>
                  <option value="routing-rules">Routing Rules</option>
                  <option value="teams">Teams</option>
                  <option value="license-users">License Users</option>
                  <option value="round-robins">Round Robins</option>
                  <option value="analytics">Analytics</option>
                </select>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
              <button
                onClick={() => setEditingPrompt(null)}
                className="rounded-lg border px-4 py-2 text-xs font-medium transition hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 dark:bg-violet-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 dark:hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
                {editingPrompt.id ? "Save Changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────── */

function PromptCard({
  prompt,
  onEdit,
  onDelete,
  onToggle,
  showToggle,
}: {
  prompt: AiCustomPrompt;
  onEdit: () => void;
  onDelete: () => void;
  onToggle?: () => void;
  showToggle?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition",
        !prompt.isActive && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold truncate">{prompt.name}</h4>
            {prompt.context && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {prompt.context}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
            {prompt.content}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {showToggle && onToggle && (
            <button
              onClick={onToggle}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                prompt.isActive ? "bg-violet-600" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                  prompt.isActive ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          )}
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
  actionLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 py-12 px-6 text-center">
      <div className="mb-3">{icon}</div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
      <button
        onClick={action}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/50 px-3 py-2 text-xs font-medium text-violet-700 dark:text-violet-300 transition hover:bg-violet-100 dark:hover:bg-violet-900"
      >
        <Plus className="h-3.5 w-3.5" />
        {actionLabel}
      </button>
    </div>
  );
}
