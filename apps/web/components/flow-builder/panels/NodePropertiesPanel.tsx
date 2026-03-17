"use client"

import { X } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { ConditionBuilder } from "@/components/condition-builder"
import type { ConditionGroup, FieldSchema } from "@/components/condition-builder/types"
import type { FlowNodeData } from "../types"

interface NodePropertiesPanelProps {
  node: FlowNodeData | null
  fields: FieldSchema[]
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void
  onClose: () => void
}

const selectClass = "mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-sm text-zinc-200 outline-none focus:border-violet-500/50 appearance-none"
const inputClass = "mt-1 w-full px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-sm text-zinc-200 outline-none focus:border-violet-500/50"
const labelClass = "text-[11px] font-semibold text-zinc-500 uppercase tracking-wider"

export function NodePropertiesPanel({ node, fields, onUpdate, onClose }: NodePropertiesPanelProps) {
  // Fetch users, teams, queues for assignment nodes
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

  if (!node) {
    return (
      <div className="w-[300px] bg-zinc-900 border-l border-zinc-800 flex items-center justify-center p-8">
        <div className="text-center text-zinc-600">
          <div className="text-sm font-medium">Select a node</div>
          <div className="text-xs mt-1">Click a node to edit its properties</div>
        </div>
      </div>
    )
  }

  const config = node.config as Record<string, any>

  const updateConfig = (key: string, value: unknown) => {
    onUpdate(node.id, { ...config, [key]: value })
  }

  // Helper to update assignee with both ID and name
  const updateAssignee = (id: string, name: string) => {
    onUpdate(node.id, { ...config, assigneeId: id, assigneeName: name })
  }

  return (
    <div className="w-[300px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">{node.type.replace("_", " ")}</div>
          <div className="text-sm font-semibold text-zinc-200 mt-0.5">{node.label || "Untitled"}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label field — common to all */}
        <div>
          <label className={labelClass}>Label</label>
          <input
            value={node.label}
            onChange={e => onUpdate(node.id, { ...config, _label: e.target.value })}
            className={inputClass}
          />
        </div>

        {/* ── ENTRY ────────────────────────────────────────────── */}
        {node.type === "ENTRY" && (
          <div className="space-y-3">
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
              <ConditionBuilder
                fields={fields}
                value={config.triggerConditions ?? []}
                onChange={(conditions: ConditionGroup[]) => updateConfig("triggerConditions", conditions)}
              />
            </div>
          </div>
        )}

        {/* ── DECISION / FILTER ────────────────────────────────── */}
        {(node.type === "DECISION" || node.type === "FILTER") && (
          <div className="space-y-3">
            <label className={labelClass}>Conditions</label>
            <ConditionBuilder
              fields={fields}
              value={config.conditions ?? []}
              onChange={(conditions: ConditionGroup[]) => updateConfig("conditions", conditions)}
            />
          </div>
        )}

        {/* ── MATCH ────────────────────────────────────────────── */}
        {node.type === "MATCH" && (
          <div className="space-y-3">
            <label className={labelClass}>Check for existing</label>
            <div className="space-y-2">
              {(["checkLeads", "checkContacts", "checkAccounts"] as const).map(key => (
                <label key={key} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={!!config[key]} onChange={e => updateConfig(key, e.target.checked)} className="rounded border-zinc-600 bg-zinc-800 accent-violet-500" />
                  {key.replace("check", "")}
                </label>
              ))}
            </div>
            <label className={labelClass}>Match by</label>
            <div className="space-y-2">
              {(["matchEmail", "matchPhone", "matchDomain", "matchCompanyName"] as const).map(key => (
                <label key={key} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={!!config[key]} onChange={e => updateConfig(key, e.target.checked)} className="rounded border-zinc-600 bg-zinc-800 accent-violet-500" />
                  {key.replace("match", "")}
                </label>
              ))}
            </div>
            <div>
              <label className={labelClass}>Mode</label>
              <select value={config.fuzzyMatchMode ?? "STRICT"} onChange={e => updateConfig("fuzzyMatchMode", e.target.value)} className={selectClass}>
                <option value="STRICT">Strict</option>
                <option value="FUZZY">Fuzzy</option>
                <option value="AI_SMART">AI Smart</option>
              </select>
            </div>
          </div>
        )}

        {/* ── ASSIGNMENT / DEFAULT ─────────────────────────────── */}
        {(node.type === "ASSIGNMENT" || node.type === "DEFAULT") && (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Assignment Type</label>
              <select
                value={config.assignmentType ?? ""}
                onChange={e => {
                  const newType = e.target.value
                  onUpdate(node.id, { ...config, assignmentType: newType, assigneeId: "", assigneeName: "" })
                }}
                className={selectClass}
              >
                <option value="">Select...</option>
                <option value="USER">Direct User</option>
                <option value="ROUND_ROBIN">Round Robin Team</option>
                <option value="QUEUE">Queue</option>
              </select>
            </div>

            {/* User picker */}
            {config.assignmentType === "USER" && (
              <div>
                <label className={labelClass}>User</label>
                <select
                  value={config.assigneeId ?? ""}
                  onChange={e => {
                    const user = users.find(u => u.id === e.target.value)
                    updateAssignee(e.target.value, user?.name ?? "")
                  }}
                  className={selectClass}
                >
                  <option value="">Select user...</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                {usersQuery.isLoading && <div className="text-[10px] text-zinc-600 mt-1">Loading users...</div>}
                {users.length === 0 && !usersQuery.isLoading && <div className="text-[10px] text-amber-500 mt-1">No licensed users found. License users first.</div>}
              </div>
            )}

            {/* Team picker */}
            {config.assignmentType === "ROUND_ROBIN" && (
              <div>
                <label className={labelClass}>Team</label>
                <select
                  value={config.assigneeId ?? ""}
                  onChange={e => {
                    const team = teams.find(t => t.id === e.target.value)
                    updateAssignee(e.target.value, team?.name ?? "")
                  }}
                  className={selectClass}
                >
                  <option value="">Select team...</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t._count?.members != null ? ` (${t._count.members} members)` : ""}</option>
                  ))}
                </select>
                {teamsQuery.isLoading && <div className="text-[10px] text-zinc-600 mt-1">Loading teams...</div>}
                {teams.length === 0 && !teamsQuery.isLoading && <div className="text-[10px] text-amber-500 mt-1">No teams found. Create a team first.</div>}
              </div>
            )}

            {/* Queue picker */}
            {config.assignmentType === "QUEUE" && (
              <div>
                <label className={labelClass}>Queue</label>
                <select
                  value={config.assigneeId ?? ""}
                  onChange={e => {
                    const queue = queues.find(q => q.id === e.target.value)
                    updateAssignee(e.target.value, queue?.name ?? "")
                  }}
                  className={selectClass}
                >
                  <option value="">Select queue...</option>
                  {queues.map(q => (
                    <option key={q.id} value={q.id}>{q.name}</option>
                  ))}
                </select>
                {queuesQuery.isLoading && <div className="text-[10px] text-zinc-600 mt-1">Loading queues...</div>}
                {queues.length === 0 && !queuesQuery.isLoading && <div className="text-[10px] text-amber-500 mt-1">No queues found. Sync queues from Salesforce first.</div>}
              </div>
            )}
          </div>
        )}

        {/* ── UPDATE FIELD ─────────────────────────────────────── */}
        {node.type === "UPDATE_FIELD" && (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Field</label>
              <select value={config.fieldApiName ?? ""} onChange={e => updateConfig("fieldApiName", e.target.value)} className={selectClass}>
                <option value="">Select field...</option>
                {fields.map(f => <option key={f.fieldApiName} value={f.fieldApiName}>{f.fieldLabel}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Value</label>
              {/* Show picklist values if available */}
              {fields.find(f => f.fieldApiName === config.fieldApiName)?.picklistValues ? (
                <select value={config.fieldValue ?? ""} onChange={e => updateConfig("fieldValue", e.target.value)} className={selectClass}>
                  <option value="">Select value...</option>
                  {(fields.find(f => f.fieldApiName === config.fieldApiName)?.picklistValues ?? []).map((v: string) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input value={config.fieldValue ?? ""} onChange={e => updateConfig("fieldValue", e.target.value)} className={inputClass} />
              )}
            </div>
          </div>
        )}

        {/* ── CREATE TASK ──────────────────────────────────────── */}
        {node.type === "CREATE_TASK" && (
          <div className="space-y-3">
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
            <div>
              <label className={labelClass}>Assigned To</label>
              <select value={config.assignedTo ?? "RECORD_OWNER"} onChange={e => updateConfig("assignedTo", e.target.value)} className={selectClass}>
                <option value="RECORD_OWNER">Record Owner</option>
                <option value="USER">Specific User</option>
              </select>
            </div>
            {config.assignedTo === "USER" && (
              <div>
                <label className={labelClass}>User</label>
                <select
                  value={config.assigneeId ?? ""}
                  onChange={e => {
                    const user = users.find(u => u.id === e.target.value)
                    onUpdate(node.id, { ...config, assigneeId: e.target.value, assigneeName: user?.name ?? "" })
                  }}
                  className={selectClass}
                >
                  <option value="">Select user...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {/* ── BRANCH DECISION ──────────────────────────────────── */}
        {node.type === "BRANCH_DECISION" && (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Branch Field</label>
              <select value={config.fieldApiName ?? ""} onChange={e => updateConfig("fieldApiName", e.target.value)} className={selectClass}>
                <option value="">Select field...</option>
                {fields.map(f => <option key={f.fieldApiName} value={f.fieldApiName}>{f.fieldLabel}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Branches</label>
              <div className="space-y-2 mt-1">
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
                      className="flex-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700/50 text-xs text-zinc-200 outline-none"
                    />
                    <button
                      onClick={() => {
                        const branches = (config.branches ?? []).filter((_: any, j: number) => j !== i)
                        updateConfig("branches", branches)
                      }}
                      className="text-zinc-600 hover:text-red-400 text-xs"
                    >✕</button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const branches = [...(config.branches ?? []), { label: "", conditions: [] }]
                    updateConfig("branches", branches)
                  }}
                  className="w-full px-2 py-1.5 rounded border border-dashed border-violet-500/30 text-violet-400 text-xs font-semibold hover:bg-violet-500/5 transition-colors"
                >+ Add Branch</button>
              </div>
            </div>
            <div>
              <label className={labelClass}>Default Branch Label</label>
              <input value={config.defaultLabel ?? "Default"} onChange={e => updateConfig("defaultLabel", e.target.value)} className={inputClass} />
            </div>
          </div>
        )}

        {/* Node ID (read-only) */}
        <div className="pt-2 border-t border-zinc-800">
          <div className="text-[10px] text-zinc-600 font-mono">ID: {node.id}</div>
        </div>
      </div>
    </div>
  )
}
