import type { RouteBuilderState } from "@/components/route-builder/types"

/**
 * Converts RouteBuilderState to the PUT /api/rules/:id body format expected by the API.
 */
export function builderToApiBody(
  state: RouteBuilderState,
  _existingRuleId?: string
): Record<string, unknown> {
  return {
    name: state.name,
    objectType: state.trigger.objectType,
    triggerEvent: state.trigger.triggerEvent,
    isDryRun: state.trigger.isDryRun,
    triggerName: state.trigger.triggerName || "",

    triggerConditions: state.trigger.triggerConditions.flatMap((group, gi) =>
      group.conditions.map((cond, ci) => ({
        groupId: group.id,
        fieldName: cond.fieldApiName,
        fieldType: cond.fieldType ?? "TEXT",
        operator: cond.operator,
        value: cond.value || null,
        sortOrder: gi * 100 + ci,
      }))
    ),

    matchConfig: state.matchConfig
      ? {
          checkLeads: state.matchConfig.checkLeads,
          checkContacts: state.matchConfig.checkContacts,
          checkAccounts: state.matchConfig.checkAccounts,
          matchEmail: state.matchConfig.matchEmail,
          matchPhone: state.matchConfig.matchPhone,
          matchDomain: state.matchConfig.matchDomain,
          matchCompanyName: state.matchConfig.matchCompanyName,
          fuzzyMatchMode: state.matchConfig.fuzzyMatchMode,
          onLeadMatch: state.matchConfig.onLeadMatch,
          leadAssignmentType:
            state.matchConfig.leadCustomAssignment?.assignmentType ?? null,
          leadAssigneeId: state.matchConfig.leadCustomAssignment?.assigneeId ?? null,
          onContactMatch: state.matchConfig.onContactMatch,
          contactAssignmentType:
            state.matchConfig.contactCustomAssignment?.assignmentType ?? null,
          contactAssigneeId:
            state.matchConfig.contactCustomAssignment?.assigneeId ?? null,
          onAccountMatch: state.matchConfig.onAccountMatch,
          accountAssignmentType:
            state.matchConfig.accountCustomAssignment?.assignmentType ?? null,
          accountAssigneeId:
            state.matchConfig.accountCustomAssignment?.assigneeId ?? null,
        }
      : null,

    branches: state.paths.map((path, i) => ({
      id: path.id,
      label: path.label,
      priority: i,
      assignmentType: path.action.assignmentType,
      assigneeUserId:
        path.action.assignmentType === "USER" ? path.action.assigneeId : null,
      assigneeTeamId:
        path.action.assignmentType === "ROUND_ROBIN" ? path.action.assigneeId : null,
      assigneeQueueId:
        path.action.assignmentType === "QUEUE" ? path.action.assigneeId : null,
      conditions: path.conditions.flatMap((group, gi) =>
        group.conditions.map((cond, ci) => ({
          groupId: group.id,
          fieldName: cond.fieldApiName,
          fieldType: cond.fieldType ?? "TEXT",
          operator: cond.operator,
          value: cond.value || null,
          sortOrder: gi * 100 + ci,
        }))
      ),
    })),

    defaultOwnerType: state.defaultOwner?.assignmentType ?? null,
    defaultOwnerUserId:
      state.defaultOwner?.assignmentType === "USER"
        ? state.defaultOwner.assigneeId
        : null,
    defaultOwnerTeamId:
      state.defaultOwner?.assignmentType === "ROUND_ROBIN"
        ? state.defaultOwner.assigneeId
        : null,
    defaultOwnerQueueId:
      state.defaultOwner?.assignmentType === "QUEUE"
        ? state.defaultOwner.assigneeId
        : null,
  }
}

/**
 * Converts an API rule response object back into a RouteBuilderState for editing.
 * Handles both the legacy flat format and the new branches-based format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiRuleToBuilderState(rule: any): RouteBuilderState {
  // Resolve default owner from the three possible ID columns
  let defaultOwner: RouteBuilderState["defaultOwner"] = null
  if (rule.defaultOwnerType) {
    const id =
      rule.defaultOwnerUserId ?? rule.defaultOwnerTeamId ?? rule.defaultOwnerQueueId ?? ""
    const assigneeName =
      rule.defaultOwnerUser?.name ??
      rule.defaultOwnerTeam?.name ??
      rule.defaultOwnerQueue?.name ??
      ""
    defaultOwner = {
      assignmentType: rule.defaultOwnerType,
      assigneeId: id,
      assigneeName,
    }
  }

  // Convert branches / paths
  const paths: RouteBuilderState["paths"] = Array.isArray(rule.branches)
    ? rule.branches.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (branch: any) => {
          // Group conditions by groupId
          const groupMap = new Map<
            string,
            { id: string; conjunction: "AND" | "OR"; conditions: typeof branch.conditions }
          >()

          if (Array.isArray(branch.conditions)) {
            for (const cond of branch.conditions) {
              const gid = cond.groupId ?? crypto.randomUUID()
              if (!groupMap.has(gid)) {
                groupMap.set(gid, {
                  id: gid,
                  conjunction: "AND",
                  conditions: [],
                })
              }
              groupMap.get(gid)!.conditions.push({
                id: crypto.randomUUID(),
                groupId: gid,
                fieldApiName: cond.fieldName,
                fieldType: cond.fieldType ?? "TEXT",
                operator: cond.operator,
                value: cond.value ?? "",
              })
            }
          }

          const assigneeId =
            branch.assigneeUserId ?? branch.assigneeTeamId ?? branch.assigneeQueueId ?? null
          const assigneeName =
            branch.assigneeUser?.name ??
            branch.assigneeTeam?.name ??
            branch.assigneeQueue?.name ??
            null

          return {
            id: branch.id ?? crypto.randomUUID(),
            label: branch.label ?? "Path",
            conditions: Array.from(groupMap.values()),
            action: {
              assignmentType: branch.assignmentType ?? null,
              assigneeId,
              assigneeName,
            },
          }
        }
      )
    : [
        {
          id: crypto.randomUUID(),
          label: "Path A",
          conditions: [],
          action: { assignmentType: null, assigneeId: null, assigneeName: null },
        },
      ]

  // Match config
  let matchConfig: RouteBuilderState["matchConfig"] = null
  if (rule.matchConfig) {
    const mc = rule.matchConfig
    matchConfig = {
      checkLeads: mc.checkLeads ?? false,
      checkContacts: mc.checkContacts ?? false,
      checkAccounts: mc.checkAccounts ?? false,
      matchEmail: mc.matchEmail ?? true,
      matchPhone: mc.matchPhone ?? false,
      matchDomain: mc.matchDomain ?? false,
      matchCompanyName: mc.matchCompanyName ?? false,
      fuzzyMatchMode: mc.fuzzyMatchMode ?? "STRICT",
      onLeadMatch: mc.onLeadMatch ?? "SFDC_MERGE",
      leadCustomAssignment:
        mc.leadAssignmentType && mc.leadAssigneeId
          ? { assignmentType: mc.leadAssignmentType, assigneeId: mc.leadAssigneeId, assigneeName: "" }
          : null,
      onContactMatch: mc.onContactMatch ?? "ASSIGN_TO_OWNER",
      contactCustomAssignment:
        mc.contactAssignmentType && mc.contactAssigneeId
          ? {
              assignmentType: mc.contactAssignmentType,
              assigneeId: mc.contactAssigneeId,
              assigneeName: "",
            }
          : null,
      onAccountMatch: mc.onAccountMatch ?? "ASSIGN_TO_OWNER",
      accountCustomAssignment:
        mc.accountAssignmentType && mc.accountAssigneeId
          ? {
              assignmentType: mc.accountAssignmentType,
              assigneeId: mc.accountAssigneeId,
              assigneeName: "",
            }
          : null,
    }
  }

  // Convert triggerConditions from API format to ConditionGroup[]
  const triggerConditionGroups: import("@/components/condition-builder/types").ConditionGroup[] = []
  if (Array.isArray(rule.triggerConditions)) {
    const tcGroupMap = new Map<string, import("@/components/condition-builder/types").ConditionGroup>()
    for (const tc of rule.triggerConditions) {
      const gid = tc.groupId ?? crypto.randomUUID()
      if (!tcGroupMap.has(gid)) {
        tcGroupMap.set(gid, {
          id: gid,
          conjunction: "AND" as const,
          conditions: [],
        })
      }
      tcGroupMap.get(gid)!.conditions.push({
        id: crypto.randomUUID(),
        groupId: gid,
        fieldApiName: tc.fieldName,
        fieldType: (tc.fieldType ?? "TEXT") as import("@/components/condition-builder/types").FieldType,
        operator: tc.operator,
        value: tc.value ?? "",
      })
    }
    triggerConditionGroups.push(...tcGroupMap.values())
  }

  return {
    name: rule.name ?? "Untitled Route",
    trigger: {
      triggerName: rule.triggerName ?? "",
      objectType: rule.objectType ?? "LEAD",
      triggerEvent: rule.triggerEvent ?? "INSERT",
      isDryRun: rule.isDryRun ?? false,
      triggerConditions: triggerConditionGroups,
    },
    matchConfig,
    paths: paths.length > 0 ? paths : [
      {
        id: crypto.randomUUID(),
        label: "Path A",
        conditions: [],
        action: { assignmentType: null, assigneeId: null, assigneeName: null },
      },
    ],
    defaultOwner,
  }
}
