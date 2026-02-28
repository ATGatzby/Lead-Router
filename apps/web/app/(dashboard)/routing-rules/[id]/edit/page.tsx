"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RuleForm, type RuleFormValues } from "@/components/rule-form/RuleForm";
import type { RuleConditions, Condition, FieldSchema } from "@/components/condition-builder";

type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE";

interface RuleDetail {
  id: string;
  name: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  triggerEvent: "INSERT" | "UPDATE" | "BOTH";
  status: "ACTIVE" | "INACTIVE";
  assignmentType: AssignmentType;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  assigneeQueueId: string | null;
  isDryRun: boolean;
  conditions: Array<{
    id: string;
    groupId: string;
    fieldName: string;
    operator: string;
    value: string | null;
    sortOrder: number;
  }>;
}

function deriveAssigneeId(rule: RuleDetail): string {
  if (rule.assignmentType === "USER") return rule.assigneeUserId ?? "";
  if (rule.assignmentType === "ROUND_ROBIN") return rule.assigneeTeamId ?? "";
  return rule.assigneeQueueId ?? "";
}

/** Convert flat DB conditions into ConditionGroup state, enriched with field types from schema */
function buildConditionGroups(
  conditions: RuleDetail["conditions"],
  fieldMap: Map<string, string>
): RuleConditions {
  const groupMap = new Map<string, Condition[]>();

  for (const c of conditions) {
    if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, []);
    groupMap.get(c.groupId)!.push({
      id: c.id,
      groupId: c.groupId,
      fieldApiName: c.fieldName,
      fieldType: (fieldMap.get(c.fieldName) ?? "TEXT") as Condition["fieldType"],
      operator: c.operator,
      value: c.value ?? "",
    });
  }

  return Array.from(groupMap.entries()).map(([id, conds]) => ({
    id,
    conjunction: "AND" as const,
    conditions: conds,
  }));
}

export default function EditRulePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const ruleQuery = useQuery<{ rule: RuleDetail }>({
    queryKey: ["rule", id],
    queryFn: async () => {
      const res = await fetch(`/api/rules/${id}`);
      if (!res.ok) throw new Error("Failed to load rule");
      return res.json();
    },
  });

  const rule = ruleQuery.data?.rule;

  // Fetch field schemas once we know the object type
  const fieldsQuery = useQuery<{ fields: FieldSchema[] }>({
    queryKey: ["fields", rule?.objectType],
    queryFn: async () => {
      const res = await fetch(`/api/fields?object=${rule!.objectType}`);
      if (!res.ok) throw new Error("Failed to load fields");
      return res.json();
    },
    enabled: !!rule,
  });

  const updateMutation = useMutation({
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

      const res = await fetch(`/api/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update rule");
      return data;
    },
    onSuccess: () => {
      router.push("/routing-rules");
    },
  });

  if (ruleQuery.isLoading || (rule && fieldsQuery.isLoading)) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">Loading rule…</div>
    );
  }

  if (ruleQuery.isError || !rule) {
    return (
      <div className="text-center py-16 text-destructive text-sm">Rule not found.</div>
    );
  }

  // Build a fieldApiName → fieldType map for type resolution
  const fieldMap = new Map<string, string>(
    (fieldsQuery.data?.fields ?? []).map((f) => [f.fieldApiName, f.fieldType])
  );

  return (
    <RuleForm
      title="Edit Rule"
      ruleId={id}
      defaultValues={{
        name: rule.name,
        objectType: rule.objectType,
        triggerEvent: rule.triggerEvent,
        assignmentType: rule.assignmentType,
        assigneeId: deriveAssigneeId(rule),
        isDryRun: rule.isDryRun,
        conditions: buildConditionGroups(rule.conditions, fieldMap),
      }}
      onSubmit={async (values) => {
        await updateMutation.mutateAsync(values);
      }}
      isSubmitting={updateMutation.isPending}
      submitLabel="Save Changes"
    />
  );
}
