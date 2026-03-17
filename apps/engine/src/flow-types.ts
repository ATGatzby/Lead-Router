// ─── Flow graph types (cached in memory) ─────────────────────────────────────

export interface CachedFlowNode {
  id: string;
  type:
    | "ENTRY"
    | "DECISION"
    | "BRANCH_DECISION"
    | "MATCH"
    | "ASSIGNMENT"
    | "UPDATE_FIELD"
    | "CREATE_TASK"
    | "FILTER"
    | "DEFAULT";
  label: string | null;
  config: Record<string, unknown> | null;
}

export interface CachedFlowEdge {
  id: string;
  fromId: string;
  toId: string;
  label: string | null;
}

export interface CachedFlow {
  id: string;
  orgId: string;
  objectType: string;
  triggerEvent: string;
  isDryRun: boolean;
  status: string;
  nodes: CachedFlowNode[];
  edges: CachedFlowEdge[];
}
