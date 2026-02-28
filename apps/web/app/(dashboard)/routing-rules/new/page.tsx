"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Settings2, Sparkles } from "lucide-react";
import { RuleForm, type RuleFormValues } from "@/components/rule-form/RuleForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ObjectType = "LEAD" | "CONTACT" | "ACCOUNT";
type Mode = "choose" | "manual" | "ai";

function NewRuleContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const objectParam = (searchParams.get("object")?.toUpperCase() ?? "LEAD") as ObjectType;
  const validObject: ObjectType = ["LEAD", "CONTACT", "ACCOUNT"].includes(objectParam)
    ? objectParam
    : "LEAD";

  const [mode, setMode] = useState<Mode>("choose");

  const createMutation = useMutation({
    mutationFn: async (values: RuleFormValues) => {
      const body = {
        name: values.name,
        objectType: values.objectType,
        triggerEvent: values.triggerEvent,
        assignmentType: values.assignmentType,
        assigneeUserId: values.assignmentType === "USER" ? values.assigneeId : null,
        assigneeTeamId: values.assignmentType === "ROUND_ROBIN" ? values.assigneeId : null,
        assigneeQueueId: values.assignmentType === "QUEUE" ? values.assigneeId : null,
        isDryRun: values.isDryRun,
        conditions: values.conditions.flatMap((group, gi) =>
          group.conditions.map((c, ci) => ({
            groupId: group.id,
            fieldName: c.fieldApiName,
            operator: c.operator,
            value: c.value || null,
            sortOrder: gi * 100 + ci,
          }))
        ),
      };

      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create rule");
      return data;
    },
    onSuccess: () => {
      router.push("/routing-rules");
    },
  });

  // ─── Choice screen ────────────────────────────────────────────────────────

  if (mode === "choose") {
    return (
      <div className="max-w-2xl space-y-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => router.push("/routing-rules")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">New Routing Rule</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Choose how you want to create your rule.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Create Manually */}
          <button
            onClick={() => setMode("manual")}
            className="rounded-xl border bg-card p-6 text-left hover:border-primary transition-colors space-y-3 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="font-medium text-base">Create Manually</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Configure conditions and logic step by step using the rule builder.
            </p>
          </button>

          {/* AI Routing Rule */}
          <button
            onClick={() => setMode("ai")}
            className="rounded-xl border bg-card p-6 text-left hover:border-violet-400 transition-colors space-y-3 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-950/50">
                <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <span className="font-medium text-base">AI Routing Rule</span>
              <Badge
                variant="secondary"
                className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400 border-0"
              >
                Beta
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Describe your rule in plain English — AI builds the conditions for you.
            </p>
          </button>
        </div>
      </div>
    );
  }

  // ─── AI placeholder ───────────────────────────────────────────────────────

  if (mode === "ai") {
    return (
      <div className="max-w-2xl space-y-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setMode("choose")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">AI Routing Rule</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create a routing rule from a plain-English description.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-10 flex flex-col items-center text-center gap-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-950/50">
            <Sparkles className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Coming Soon</h2>
            <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
              We&apos;re building an experience where you describe your routing logic in plain
              English and we configure the rule for you automatically.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setMode("manual")}>
            Create Manually Instead
          </Button>
        </div>
      </div>
    );
  }

  // ─── Manual form (existing flow) ─────────────────────────────────────────

  return (
    <RuleForm
      title="New Routing Rule"
      defaultValues={{
        name: "",
        objectType: validObject,
        triggerEvent: "INSERT",
        assignmentType: "ROUND_ROBIN",
        assigneeId: "",
        isDryRun: false,
        conditions: [],
      }}
      onSubmit={async (values) => {
        await createMutation.mutateAsync(values);
      }}
      isSubmitting={createMutation.isPending}
      submitLabel="Create Rule"
    />
  );
}

export default function NewRulePage() {
  return (
    <Suspense>
      <NewRuleContent />
    </Suspense>
  );
}
