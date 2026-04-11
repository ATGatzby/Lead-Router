"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ConditionBuilder, type RuleConditions, type FieldSchema } from "@/components/condition-builder";
import { AssigneeSelect } from "./AssigneeSelect";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type ObjectType = "LEAD" | "CONTACT" | "ACCOUNT" | "COMPANY" | "DEAL";
type TriggerEvent = "INSERT" | "UPDATE" | "BOTH";
type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE";

export interface RuleFormValues {
  name: string;
  objectType: ObjectType;
  triggerEvent: TriggerEvent;
  assignmentType: AssignmentType;
  assigneeId: string;
  isDryRun: boolean;
  conditions: RuleConditions;
}

interface Props {
  title: string;
  defaultValues: RuleFormValues;
  onSubmit: (values: RuleFormValues) => Promise<void>;
  isSubmitting: boolean;
  submitLabel?: string;
  ruleId?: string; // set for edit mode — enables Test Rule panel
}

interface FieldsResponse {
  fields: FieldSchema[];
}

// ─── Test Rule Panel ─────────────────────────────────────────────────────────

interface TestRuleResult {
  ruleName: string;
  matched: boolean;
  isCatchAll: boolean;
  status: string;
  groups: Array<{
    groupId: string;
    passed: boolean;
    conditions: Array<{
      fieldName: string;
      operator: string;
      value: string | null;
      passed: boolean;
      reason?: string;
    }>;
  }>;
}

function TestRulePanel({ ruleId }: { ruleId: string }) {
  const [jsonInput, setJsonInput] = useState(
    '{\n  "LeadSource": "Web",\n  "AnnualRevenue": 150000\n}'
  );
  const [result, setResult] = useState<TestRuleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setError(null);
    setResult(null);

    let record: unknown;
    try {
      record = JSON.parse(jsonInput);
    } catch {
      setError("Invalid JSON — check your input.");
      return;
    }

    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      setError("Record must be a JSON object.");
      return;
    }

    setRunning(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Test failed");
        return;
      }
      setResult(data);
    } catch {
      setError("Request failed. Try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium text-sm">Test Rule</h3>
        <span className="text-xs text-muted-foreground ml-1">
          Paste a sample record to see if this rule would match. No changes are made to Salesforce.
        </span>
      </div>

      <textarea
        className="w-full rounded-md border border-input bg-muted/30 px-3 py-2 text-xs font-mono resize-y min-h-[100px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
        spellCheck={false}
      />

      <Button size="sm" variant="outline" onClick={run} disabled={running}>
        {running ? "Evaluating…" : "Evaluate →"}
      </Button>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium",
              result.matched
                ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                : "bg-muted text-muted-foreground"
            )}
          >
            <span>{result.matched ? "✅" : "❌"}</span>
            <span>
              {result.matched
                ? result.isCatchAll
                  ? "Matched (catch-all — no conditions)"
                  : "Rule matched"
                : "Rule did not match"}
            </span>
            {result.status === "INACTIVE" && (
              <span className="ml-auto text-xs">(rule is inactive)</span>
            )}
          </div>

          {result.groups.length > 0 && (
            <div className="space-y-2">
              {result.groups.map((group, gi) => (
                <div key={group.groupId} className="rounded-md border bg-muted/20 overflow-hidden">
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-xs font-medium border-b",
                      group.passed
                        ? "bg-green-50 text-green-700 dark:bg-green-950/30"
                        : "bg-muted/60 text-muted-foreground"
                    )}
                  >
                    <span>{group.passed ? "✅" : "❌"}</span>
                    Group {gi + 1} — {group.passed ? "passed" : "failed"}
                  </div>
                  <div className="divide-y">
                    {group.conditions.map((c, ci) => (
                      <div
                        key={ci}
                        className={cn(
                          "flex items-start gap-2 px-3 py-2 text-xs",
                          c.passed ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        <span className="shrink-0">{c.passed ? "✓" : "✗"}</span>
                        <div>
                          <span className="font-mono">{c.fieldName}</span>
                          <span className="mx-1 text-muted-foreground">{c.operator}</span>
                          {c.value != null && (
                            <span className="font-mono">{c.value}</span>
                          )}
                          {!c.passed && c.reason && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">{c.reason}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Form ───────────────────────────────────────────────────────────────

export function RuleForm({
  title,
  defaultValues,
  onSubmit,
  isSubmitting,
  submitLabel = "Save Rule",
  ruleId,
}: Props) {
  const router = useRouter();

  const [name, setName] = useState(defaultValues.name);
  const [objectType, setObjectType] = useState<ObjectType>(defaultValues.objectType);
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>(defaultValues.triggerEvent);
  const [assignmentType, setAssignmentType] = useState<AssignmentType>(defaultValues.assignmentType);
  const [assigneeId, setAssigneeId] = useState(defaultValues.assigneeId);
  const [isDryRun, setIsDryRun] = useState(defaultValues.isDryRun);
  const [conditions, setConditions] = useState<RuleConditions>(defaultValues.conditions);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const fieldsQuery = useQuery<FieldsResponse>({
    queryKey: ["fields", objectType],
    queryFn: async () => {
      const res = await fetch(`/api/fields?object=${objectType}`);
      if (!res.ok) throw new Error("Failed to load fields");
      return res.json();
    },
  });

  const fields = fieldsQuery.data?.fields ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!name.trim()) {
      setSubmitError("Rule name is required.");
      return;
    }
    if (!assigneeId) {
      setSubmitError("Please select an assignee.");
      return;
    }

    try {
      await onSubmit({
        name,
        objectType,
        triggerEvent,
        assignmentType,
        assigneeId,
        isDryRun,
        conditions,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save rule.");
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => router.push("/routing-rules")}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* ── Section: Basic info ─────────────────────────────────────── */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">
            Rule details
          </h2>

          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Rule name</Label>
            <Input
              id="rule-name"
              placeholder="e.g. Enterprise Inbound Leads — West"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Object type</Label>
              <Select
                value={objectType}
                onValueChange={(v) => {
                  setObjectType(v as ObjectType);
                  setConditions([]); // reset conditions when object changes
                }}
                disabled={!!ruleId} // can't change object type on edit
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LEAD">Lead</SelectItem>
                  <SelectItem value="CONTACT">Contact</SelectItem>
                  <SelectItem value="ACCOUNT">Account</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Trigger event</Label>
              <Select value={triggerEvent} onValueChange={(v) => setTriggerEvent(v as TriggerEvent)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INSERT">On create</SelectItem>
                  <SelectItem value="UPDATE">On update</SelectItem>
                  <SelectItem value="BOTH">On create or update</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="dry-run"
              checked={isDryRun}
              onCheckedChange={setIsDryRun}
            />
            <div>
              <Label htmlFor="dry-run" className="cursor-pointer">
                Dry run mode
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evaluate rule and log result without making assignments in Salesforce.
              </p>
            </div>
          </div>
        </div>

        {/* ── Section: Assignment ─────────────────────────────────────── */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">
            Assignment
          </h2>
          <AssigneeSelect
            assignmentType={assignmentType}
            assigneeId={assigneeId}
            onTypeChange={setAssignmentType}
            onAssigneeChange={setAssigneeId}
          />
        </div>

        {/* ── Section: Conditions ─────────────────────────────────────── */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">
                Conditions
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Leave empty to create a catch-all rule that matches every record.
              </p>
            </div>
            {fieldsQuery.isLoading && (
              <span className="text-xs text-muted-foreground">Loading fields…</span>
            )}
            {fieldsQuery.isSuccess && fields.length === 0 && (
              <span className="text-xs text-amber-600">
                No fields synced yet. Use &quot;Sync Fields&quot; on the rules list.
              </span>
            )}
          </div>

          <ConditionBuilder
            value={conditions}
            onChange={setConditions}
            fields={fields}
          />
        </div>

        {/* Error */}
        {submitError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : submitLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/routing-rules")}
          >
            Cancel
          </Button>
        </div>
      </form>

      {/* Test Rule panel (edit mode only) */}
      {ruleId && <TestRulePanel ruleId={ruleId} />}
    </div>
  );
}
