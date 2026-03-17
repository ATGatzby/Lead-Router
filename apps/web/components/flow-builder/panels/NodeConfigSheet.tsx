"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ConditionBuilder } from "@/components/condition-builder"
import type { ConditionGroup, FieldSchema } from "@/components/condition-builder/types"
import type { FlowNodeData } from "../types"

interface NodeConfigSheetProps {
  node: FlowNodeData | null
  fields: FieldSchema[]
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void
  onClose: () => void
}

const selectClass = "mt-1.5 w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none focus:border-violet-400 bg-white"
const inputClass = "mt-1.5 w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none focus:border-violet-400"
const labelClass = "text-xs font-medium text-zinc-500 uppercase tracking-wider"

export function NodeConfigSheet({ node, fields, onUpdate, onClose }: NodeConfigSheetProps) {
  const usersQuery = useQuery<{ users: Array<{ id: string; name: string; sfdcUserId: string; isLicensed: boolean }> }>({
    queryKey: ["users-licensed"],
    queryFn: async () => {
      const res = await fetch("/api/users?licensed=true")
      if (!res.ok) return { users: [] }
      return res.json()
    },
    enabled: !!node && (node.type === "ASSIGNMENT" || node.type === "DEFAULT" || node.type === "CREATE_TASK"),
  })

  const teamsQuery = useQuery<{ teams: Array<{ id: string; name: string; _count?: { members: number } }> }>({
    queryKey: ["teams"],
    queryFn: async () => {
      const res = await fetch("/api/teams")
      if (!res.ok) return { teams: [] }
      return res.json()
    },
    enabled: !!node && (node.type === "ASSIGNMENT" || node.type === "DEFAULT"),
  })

  const queuesQuery = useQuery<{ queues: Array<{ id: string; name: string; sfdcQueueId: string }> }>({
    queryKey: ["queues"],
    queryFn: async () => {
      const res = await fetch("/api/queues")
      if (!res.ok) return { queues: [] }
      return res.json()
    },
    enabled: !!node && (node.type === "ASSIGNMENT" || node.type === "DEFAULT"),
  })

  const users = usersQuery.data?.users ?? []
  const teams = teamsQuery.data?.teams ?? []
  const queues = queuesQuery.data?.queues ?? []

  if (!node) return null

  const config = node.config as Record<string, any>

  const updateConfig = (key: string, value: unknown) => {
    onUpdate(node.id, { ...config, [key]: value })
  }

  const updateAssignee = (id: string, name: string) => {
    onUpdate(node.id, { ...config, assigneeId: id, assigneeName: name })
  }

  const titleMap: Record<string, string> = {
    ENTRY: "Trigger Settings",
    DECISION: "Decision Conditions",
    BRANCH_DECISION: "Branch Configuration",
    MATCH: "Match Configuration",
    ASSIGNMENT: "Assignment",
    DEFAULT: "Default Owner",
    UPDATE_FIELD: "Update Field",
    CREATE_TASK: "Create Task",
    FILTER: "Filter Conditions",
  }

  const descMap: Record<string, string> = {
    ENTRY: "When should this flow run?",
    DECISION: "Records are routed to Yes or No based on these conditions.",
    BRANCH_DECISION: "Split flow based on field values.",
    MATCH: "Check for existing records in Salesforce.",
    ASSIGNMENT: "Route the record to a user, team, or queue.",
    DEFAULT: "Fallback if no other path matches.",
    UPDATE_FIELD: "Set a field value before routing continues.",
    CREATE_TASK: "Create a follow-up task in Salesforce.",
    FILTER: "Records matching all condition groups will pass through.",
  }

  return (
    <Sheet open={!!node} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{titleMap[node.type] ?? node.type}</SheetTitle>
          <SheetDescription>{descMap[node.type] ?? "Configure this step"}</SheetDescription>
        </SheetHeader>

        <SheetBody>
          <div className="space-y-5">
            {/* Label */}
            <div>
              <label className={labelClass}>Label</label>
              <input value={node.label} onChange={e => onUpdate(node.id, { ...config, _label: e.target.value })} className={inputClass} />
            </div>

            {/* ENTRY */}
            {node.type === "ENTRY" && (
              <>
                <div>
                  <label className={labelClass}>Trigger Event</label>
                  <select value={config.triggerEvent ?? "BOTH"} onChange={e => updateConfig("triggerEvent", e.target.value)} className={selectClass}>
                    <option value="INSERT">On Create</option>
                    <option value="UPDATE">On Update</option>
                    <option value="BOTH">On Create or Update</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Trigger Conditions</label>
                  <ConditionBuilder fields={fields} value={config.triggerConditions ?? []} onChange={(c: ConditionGroup[]) => updateConfig("triggerConditions", c)} />
                </div>
              </>
            )}

            {/* DECISION / FILTER */}
            {(node.type === "DECISION" || node.type === "FILTER") && (
              <div>
                <label className={labelClass}>Conditions</label>
                <ConditionBuilder fields={fields} value={config.conditions ?? []} onChange={(c: ConditionGroup[]) => updateConfig("conditions", c)} />
              </div>
            )}

            {/* MATCH */}
            {node.type === "MATCH" && (
              <>
                <div>
                  <label className={labelClass}>Check for existing</label>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {(["checkLeads", "checkContacts", "checkAccounts"] as const).map(key => (
                      <label key={key} className="flex items-center gap-2 text-sm text-zinc-700">
                        <input type="checkbox" checked={!!config[key]} onChange={e => updateConfig(key, e.target.checked)} className="accent-blue-500" />
                        {key.replace("check", "")}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Match by</label>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {(["matchEmail", "matchPhone", "matchDomain", "matchCompanyName"] as const).map(key => (
                      <label key={key} className="flex items-center gap-2 text-sm text-zinc-700">
                        <input type="checkbox" checked={!!config[key]} onChange={e => updateConfig(key, e.target.checked)} className="accent-blue-500" />
                        {key.replace("match", "")}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Mode</label>
                  <select value={config.fuzzyMatchMode ?? "STRICT"} onChange={e => updateConfig("fuzzyMatchMode", e.target.value)} className={selectClass}>
                    <option value="STRICT">Strict</option>
                    <option value="FUZZY">Fuzzy</option>
                    <option value="AI_SMART">AI Smart</option>
                  </select>
                </div>
              </>
            )}

            {/* ASSIGNMENT / DEFAULT */}
            {(node.type === "ASSIGNMENT" || node.type === "DEFAULT") && (
              <>
                <div>
                  <label className={labelClass}>Assignment Type</label>
                  <select
                    value={config.assignmentType ?? ""}
                    onChange={e => onUpdate(node.id, { ...config, assignmentType: e.target.value, assigneeId: "", assigneeName: "" })}
                    className={selectClass}
                  >
                    <option value="">Select...</option>
                    <option value="USER">Direct User</option>
                    <option value="ROUND_ROBIN">Round Robin Team</option>
                    <option value="QUEUE">Queue</option>
                  </select>
                </div>
                {config.assignmentType === "USER" && (
                  <div>
                    <label className={labelClass}>User</label>
                    <select value={config.assigneeId ?? ""} onChange={e => { const u = users.find(u => u.id === e.target.value); updateAssignee(e.target.value, u?.name ?? "") }} className={selectClass}>
                      <option value="">Select user...</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                )}
                {config.assignmentType === "ROUND_ROBIN" && (
                  <div>
                    <label className={labelClass}>Team</label>
                    <select value={config.assigneeId ?? ""} onChange={e => { const t = teams.find(t => t.id === e.target.value); updateAssignee(e.target.value, t?.name ?? "") }} className={selectClass}>
                      <option value="">Select team...</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}{t._count?.members != null ? ` (${t._count.members})` : ""}</option>)}
                    </select>
                  </div>
                )}
                {config.assignmentType === "QUEUE" && (
                  <div>
                    <label className={labelClass}>Queue</label>
                    <select value={config.assigneeId ?? ""} onChange={e => { const q = queues.find(q => q.id === e.target.value); updateAssignee(e.target.value, q?.name ?? "") }} className={selectClass}>
                      <option value="">Select queue...</option>
                      {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* UPDATE_FIELD */}
            {node.type === "UPDATE_FIELD" && (
              <>
                <div>
                  <label className={labelClass}>Field</label>
                  <select value={config.fieldApiName ?? ""} onChange={e => updateConfig("fieldApiName", e.target.value)} className={selectClass}>
                    <option value="">Select field...</option>
                    {fields.map(f => <option key={f.fieldApiName} value={f.fieldApiName}>{f.fieldLabel}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Value</label>
                  {fields.find(f => f.fieldApiName === config.fieldApiName)?.picklistValues ? (
                    <select value={config.fieldValue ?? ""} onChange={e => updateConfig("fieldValue", e.target.value)} className={selectClass}>
                      <option value="">Select value...</option>
                      {(fields.find(f => f.fieldApiName === config.fieldApiName)?.picklistValues ?? []).map((v: string) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input value={config.fieldValue ?? ""} onChange={e => updateConfig("fieldValue", e.target.value)} className={inputClass} />
                  )}
                </div>
              </>
            )}

            {/* CREATE_TASK */}
            {node.type === "CREATE_TASK" && (
              <>
                <div>
                  <label className={labelClass}>Subject</label>
                  <input value={config.subject ?? ""} onChange={e => updateConfig("subject", e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Priority</label>
                  <select value={config.priority ?? "Normal"} onChange={e => updateConfig("priority", e.target.value)} className={selectClass}>
                    <option value="High">High</option>
                    <option value="Normal">Normal</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Due in (days)</label>
                  <input type="number" value={config.dueDateOffset ?? ""} onChange={e => updateConfig("dueDateOffset", e.target.value ? Number(e.target.value) : null)} placeholder="No due date" className={inputClass} />
                </div>
              </>
            )}

            {/* BRANCH_DECISION */}
            {node.type === "BRANCH_DECISION" && (
              <>
                <div>
                  <label className={labelClass}>Branch Field</label>
                  <select value={config.fieldApiName ?? ""} onChange={e => updateConfig("fieldApiName", e.target.value)} className={selectClass}>
                    <option value="">Select field...</option>
                    {fields.map(f => <option key={f.fieldApiName} value={f.fieldApiName}>{f.fieldLabel}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Branches</label>
                  <div className="space-y-2 mt-2">
                    {(config.branches ?? []).map((b: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={b.label ?? ""}
                          onChange={e => {
                            const branches = [...(config.branches ?? [])]
                            branches[i] = { ...branches[i], label: e.target.value }
                            updateConfig("branches", branches)
                          }}
                          placeholder={`Branch ${i + 1}`}
                          className="flex-1 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-700 outline-none"
                        />
                        <button onClick={() => updateConfig("branches", (config.branches ?? []).filter((_: any, j: number) => j !== i))} className="text-zinc-300 hover:text-red-400 text-xs">✕</button>
                      </div>
                    ))}
                    <button
                      onClick={() => updateConfig("branches", [...(config.branches ?? []), { label: "", conditions: [] }])}
                      className="flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-700 transition"
                    >+ Add Branch</button>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Default Branch Label</label>
                  <input value={config.defaultLabel ?? "Default"} onChange={e => updateConfig("defaultLabel", e.target.value)} className={inputClass} />
                </div>
              </>
            )}

            {/* Node ID */}
            <div className="pt-3 border-t border-zinc-100">
              <p className="text-[10px] text-zinc-400 font-mono">ID: {node.id}</p>
            </div>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={onClose}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
