import type { RouteBuilderState } from "@/components/route-builder/types"
import { resolveObjectType } from "@/components/route-builder/types"

/**
 * Converts RouteBuilderState to the PUT /api/rules/:id body format expected by the API.
 */
export function builderToApiBody(
  state: RouteBuilderState,
  _existingRuleId?: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: state.name,
    routeType: state.searchTrigger ? "SCHEDULED" : "REALTIME",
    objectType: resolveObjectType(state),
    triggerEvent: state.trigger?.triggerEvent ?? "SEARCH",
    isDryRun: state.trigger?.isDryRun ?? state.searchTrigger?.isDryRun ?? false,
    triggerName: state.trigger?.triggerName || "",

    triggerConditions: state.trigger
      ? state.trigger.triggerConditions.flatMap((group, gi) =>
          group.conditions.map((cond, ci) => ({
            groupId: group.id,
            fieldName: cond.fieldApiName,
            fieldType: cond.fieldType ?? "TEXT",
            operator: cond.operator,
            value: cond.value || null,
            sortOrder: gi * 100 + ci,
          }))
        )
      : [],

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

    branches: state.paths.map((path, i) => {
      // For V2 paths (with steps[]), derive conditions from steps[0] to keep one source of truth
      const filterStep = path.steps?.find(s => s.type === "filter")
      const conditionSource = (filterStep?.type === "filter" && filterStep.conditions?.length > 0)
        ? filterStep.conditions
        : path.conditions
      return {
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
        steps: path.steps ?? null,
        conditions: conditionSource.flatMap((group: any, gi: number) =>
          (group.conditions ?? []).map((cond: any, ci: number) => ({
            groupId: group.id ?? group.groupId,
            fieldName: cond.fieldApiName ?? cond.fieldName,
            fieldType: cond.fieldType ?? "TEXT",
            operator: cond.operator,
            value: cond.value || null,
            sortOrder: gi * 100 + ci,
          }))
        ),
      }
    }),

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

  // Search trigger → Scheduled route fields
  if (state.searchTrigger) {
    body.routeType = "SCHEDULED"
    body.objectType = state.searchTrigger.objectType
    body.searchCriteria = state.searchTrigger.searchCriteria
    body.scheduleFrequency = state.searchTrigger.frequency
    body.scheduleTime = state.searchTrigger.scheduleTime
    body.scheduleTimezone = state.searchTrigger.scheduleTimezone
    body.triggerEvent = "SEARCH"
    body.searchMaxRecords = state.searchTrigger.searchMaxRecords ?? null
    body.searchBatchSize = state.searchTrigger.batchSize ?? 500
  }

  return body
}

/**
 * Converts an API rule response object back into a RouteBuilderState for editing.
 * Handles both the legacy flat format and the new branches-based format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiRuleToBuilderState(rule: any): RouteBuilderState {
  try {
    return _apiRuleToBuilderState(rule)
  } catch (err) {
    console.error("[apiRuleToBuilderState] Conversion failed, returning safe defaults:", err)
    return {
      name: rule?.name ?? "Untitled Route",
      routeType: rule?.routeType ?? "REALTIME",
      trigger: {
        triggerName: rule?.triggerName ?? "",
        objectType: rule?.objectType ?? "LEAD",
        triggerEvent: rule?.triggerEvent ?? "INSERT",
        isDryRun: rule?.isDryRun ?? false,
        triggerConditions: [],
      },
      searchTrigger: null,
      matchConfig: null,
      paths: [{
        id: crypto.randomUUID(),
        label: "Path A",
        conditions: [],
        action: { assignmentType: null, assigneeId: null, assigneeName: null },
      }],
      defaultOwner: null,
    }
  }
}

function _apiRuleToBuilderState(rule: any): RouteBuilderState {
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
            ...(branch.steps ? { steps: Array.isArray(branch.steps) ? branch.steps : JSON.parse(String(branch.steps)) } : {}),
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

  // Search trigger config
  let searchTrigger: RouteBuilderState["searchTrigger"] = null
  if (rule.routeType === "SCHEDULED" || rule.triggerEvent === "SEARCH") {
    // Convert searchCriteria from DB JSON to ConditionGroup[] format
    // The AI may store flat conditions [{groupId, fieldName, ...}] instead of ConditionGroup[] [{id, conjunction, conditions: [...]}]
    let searchCriteriaGroups: import("@/components/condition-builder/types").ConditionGroup[] = []
    if (Array.isArray(rule.searchCriteria)) {
      // Check if it's already in ConditionGroup format (has .conditions sub-array)
      const isGroupFormat = rule.searchCriteria.length > 0 && Array.isArray(rule.searchCriteria[0]?.conditions)
      if (isGroupFormat) {
        searchCriteriaGroups = rule.searchCriteria
      } else {
        // Convert flat conditions to grouped format (same logic as triggerConditions above)
        const scGroupMap = new Map<string, import("@/components/condition-builder/types").ConditionGroup>()
        for (const sc of rule.searchCriteria) {
          if (!sc.fieldName) continue // skip invalid entries
          const gid = sc.groupId ?? crypto.randomUUID()
          if (!scGroupMap.has(gid)) {
            scGroupMap.set(gid, { id: gid, conjunction: "AND" as const, conditions: [] })
          }
          scGroupMap.get(gid)!.conditions.push({
            id: crypto.randomUUID(),
            groupId: gid,
            fieldApiName: sc.fieldName,
            fieldType: (sc.fieldType ?? "TEXT") as import("@/components/condition-builder/types").FieldType,
            operator: sc.operator,
            value: sc.value ?? "",
          })
        }
        searchCriteriaGroups = Array.from(scGroupMap.values())
      }
    }

    searchTrigger = {
      triggerName: rule.triggerName ?? "",
      objectType: rule.objectType ?? "LEAD",
      searchCriteria: searchCriteriaGroups,
      frequency: rule.scheduleFrequency ?? null,
      scheduleTime: rule.scheduleTime ?? "06:00",
      scheduleTimezone: rule.scheduleTimezone ?? "UTC",
      batchSize: rule.searchBatchSize ?? rule.batchSize ?? 500,
      searchMaxRecords: rule.searchMaxRecords ?? null,
      skipRecentlyRouted: rule.skipRecentlyRouted ?? true,
      isDryRun: rule.isDryRun ?? false,
    }
  }

  // Determine if this route has a real-time trigger.
  // Scheduled-only routes (triggerEvent === SEARCH with no trigger conditions) have no real-time trigger.
  const isScheduledOnly =
    (rule.routeType === "SCHEDULED" || rule.triggerEvent === "SEARCH") &&
    triggerConditionGroups.length === 0
  const trigger: RouteBuilderState["trigger"] = isScheduledOnly
    ? null
    : {
        triggerName: rule.triggerName ?? "",
        objectType: rule.objectType ?? "LEAD",
        triggerEvent: rule.triggerEvent ?? "INSERT",
        isDryRun: rule.isDryRun ?? false,
        triggerConditions: triggerConditionGroups,
      }

  return {
    name: rule.name ?? "Untitled Route",
    routeType: rule.routeType ?? "REALTIME",
    trigger,
    searchTrigger,
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
