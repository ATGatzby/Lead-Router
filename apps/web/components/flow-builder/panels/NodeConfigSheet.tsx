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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { AssigneeSelect } from "@/components/rule-form/AssigneeSelect"
import { ConditionBuilder } from "@/components/condition-builder"
import { cn } from "@/lib/utils"
import type { ConditionGroup, FieldSchema } from "@/components/condition-builder/types"
import type { FlowNodeData } from "../types"
import type { AssignmentType } from "@/components/route-builder/types"

interface NodeConfigSheetProps {
  node: FlowNodeData | null
  fields: FieldSchema[]
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void
  onClose: () => void
}

const selectClass = "mt-1.5 w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none focus:border-violet-400 bg-white"
const inputClass = "mt-1.5 w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none focus:border-violet-400"
const labelClass = "text-xs font-medium text-zinc-500 uppercase tracking-wider"

/* ── Match config helpers (ported from Route Builder MatchConfigSheet) ──── */

interface MatchRadioOptionProps {
  id: string
  name: string
  value: string
  checked: boolean
  onChange: () => void
  label: string
  description?: string
  recommended?: boolean
}

function MatchRadioOption({ id, name, value, checked, onChange, label, description, recommended }: MatchRadioOptionProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
      )}
    >
      <input
        type="radio"
        id={id}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 accent-primary"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {recommended && (
            <span className="text-[10px] font-semibold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900 px-1.5 py-0.5 rounded-full">
              Recommended
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
    </label>
  )
}

function MatchCheckField({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <div>
        <Label htmlFor={id} className="cursor-pointer font-medium text-sm">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  )
}

export function NodeConfigSheet({ node, fields, onUpdate, onClose }: NodeConfigSheetProps) {
  const usersQuery = useQuery<{ users: Array<{ id: string; name: string; sfdcUserId: string; isLicensed: boolean }> }>({
    queryKey: ["users-licensed"],
    queryFn: async () => {
      const res = await fetch("/api/users?licensed=true")
      if (!res.ok) return { users: [] }
      return res.json()
    },
    enabled: !!node && (node.type === "ASSIGNMENT" || node.type === "DEFAULT" || node.type === "CREATE_TASK" || node.type === "MATCH"),
  })

  const teamsQuery = useQuery<{ teams: Array<{ id: string; name: string; _count?: { members: number } }> }>({
    queryKey: ["teams"],
    queryFn: async () => {
      const res = await fetch("/api/teams")
      if (!res.ok) return { teams: [] }
      return res.json()
    },
    enabled: !!node && (node.type === "ASSIGNMENT" || node.type === "DEFAULT" || node.type === "MATCH"),
  })

  const queuesQuery = useQuery<{ queues: Array<{ id: string; name: string; sfdcQueueId: string }> }>({
    queryKey: ["queues"],
    queryFn: async () => {
      const res = await fetch("/api/queues")
      if (!res.ok) return { queues: [] }
      return res.json()
    },
    enabled: !!node && (node.type === "ASSIGNMENT" || node.type === "DEFAULT" || node.type === "MATCH"),
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
                {/* Check against existing records */}
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Check against existing records
                  </h3>
                  <div className="space-y-2.5">
                    <MatchCheckField
                      id="flow-checkLeads"
                      label="Existing Leads"
                      description="Match against leads with the same email or phone"
                      checked={!!config.checkLeads}
                      onChange={(v) => updateConfig("checkLeads", v)}
                    />
                    <MatchCheckField
                      id="flow-checkContacts"
                      label="Existing Contacts"
                      description="Match against contacts with the same email or phone"
                      checked={!!config.checkContacts}
                      onChange={(v) => updateConfig("checkContacts", v)}
                    />
                    <MatchCheckField
                      id="flow-checkAccounts"
                      label="Existing Accounts"
                      description="Match against accounts by company domain"
                      checked={!!config.checkAccounts}
                      onChange={(v) => updateConfig("checkAccounts", v)}
                    />
                  </div>
                </section>

                {/* Match on */}
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Match on
                  </h3>
                  <div className="space-y-2.5">
                    <MatchCheckField
                      id="flow-matchEmail"
                      label="Email address (exact)"
                      checked={!!config.matchEmail}
                      onChange={(v) => updateConfig("matchEmail", v)}
                    />
                    <MatchCheckField
                      id="flow-matchPhone"
                      label="Phone number (normalized)"
                      description="Strips formatting before comparing"
                      checked={!!config.matchPhone}
                      onChange={(v) => updateConfig("matchPhone", v)}
                    />
                    <MatchCheckField
                      id="flow-matchDomain"
                      label="Company domain"
                      description="Extracts domain from email, matches against Account website"
                      checked={!!config.matchDomain}
                      onChange={(v) => updateConfig("matchDomain", v)}
                    />
                    <MatchCheckField
                      id="flow-matchCompanyName"
                      label="Company name"
                      description="Match against Account name using the selected strategy"
                      checked={!!config.matchCompanyName}
                      onChange={(v) => updateConfig("matchCompanyName", v)}
                    />
                    {!!config.matchCompanyName && (
                      <div className="ml-7 space-y-2">
                        <MatchRadioOption
                          id="flow-fuzzy-strict"
                          name="flow-fuzzyMatchMode"
                          value="STRICT"
                          checked={(config.fuzzyMatchMode ?? "STRICT") === "STRICT"}
                          onChange={() => updateConfig("fuzzyMatchMode", "STRICT")}
                          label="Strict"
                          description="Exact company name match (normalized)"
                          recommended
                        />
                        <MatchRadioOption
                          id="flow-fuzzy-fuzzy"
                          name="flow-fuzzyMatchMode"
                          value="FUZZY"
                          checked={config.fuzzyMatchMode === "FUZZY"}
                          onChange={() => updateConfig("fuzzyMatchMode", "FUZZY")}
                          label="Fuzzy"
                          description="String similarity + known abbreviations (e.g. Corp vs Corporation)"
                        />
                        <MatchRadioOption
                          id="flow-fuzzy-ai"
                          name="flow-fuzzyMatchMode"
                          value="AI_SMART"
                          checked={config.fuzzyMatchMode === "AI_SMART"}
                          onChange={() => updateConfig("fuzzyMatchMode", "AI_SMART")}
                          label="AI Smart"
                          description="Semantic matching with AI fallback for ambiguous names"
                        />
                      </div>
                    )}
                  </div>
                </section>

                {/* When Lead matched */}
                {!!config.checkLeads && (
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      When a Lead is matched
                    </h3>
                    <div className="space-y-2">
                      <MatchRadioOption
                        id="flow-leadMatch-merge"
                        name="flow-leadMatch"
                        value="SFDC_MERGE"
                        checked={(config.onLeadMatch ?? "SFDC_MERGE") === "SFDC_MERGE"}
                        onChange={() => { updateConfig("onLeadMatch", "SFDC_MERGE"); updateConfig("leadCustomAssignment", null) }}
                        label="Salesforce Lead Merge"
                        description="Merge this lead into the existing lead"
                        recommended
                      />
                      <MatchRadioOption
                        id="flow-leadMatch-owner"
                        name="flow-leadMatch"
                        value="ASSIGN_TO_OWNER"
                        checked={config.onLeadMatch === "ASSIGN_TO_OWNER"}
                        onChange={() => { updateConfig("onLeadMatch", "ASSIGN_TO_OWNER"); updateConfig("leadCustomAssignment", null) }}
                        label="Assign to lead's owner"
                        description="Assign the new lead to the matched lead's current owner"
                      />
                      <MatchRadioOption
                        id="flow-leadMatch-custom"
                        name="flow-leadMatch"
                        value="ASSIGN_CUSTOM"
                        checked={config.onLeadMatch === "ASSIGN_CUSTOM"}
                        onChange={() => {
                          updateConfig("onLeadMatch", "ASSIGN_CUSTOM")
                          updateConfig("leadCustomAssignment", { assignmentType: "USER", assigneeId: "", assigneeName: "" })
                        }}
                        label="Assign to..."
                        description="Choose a specific user, team, or queue"
                      />
                      {config.onLeadMatch === "ASSIGN_CUSTOM" && (
                        <div className="ml-6 mt-2">
                          <AssigneeSelect
                            assignmentType={(config.leadCustomAssignment as any)?.assignmentType ?? "USER"}
                            assigneeId={(config.leadCustomAssignment as any)?.assigneeId ?? ""}
                            onTypeChange={(type: AssignmentType) =>
                              updateConfig("leadCustomAssignment", { assignmentType: type, assigneeId: "", assigneeName: "" })
                            }
                            onAssigneeChange={(id: string) =>
                              updateConfig("leadCustomAssignment", {
                                ...((config.leadCustomAssignment as any) ?? { assignmentType: "USER", assigneeName: "" }),
                                assigneeId: id,
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* When Contact matched */}
                {!!config.checkContacts && (
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      When a Contact is matched
                    </h3>
                    <div className="space-y-2">
                      <MatchRadioOption
                        id="flow-contactMatch-owner"
                        name="flow-contactMatch"
                        value="ASSIGN_TO_OWNER"
                        checked={(config.onContactMatch ?? "ASSIGN_TO_OWNER") === "ASSIGN_TO_OWNER"}
                        onChange={() => { updateConfig("onContactMatch", "ASSIGN_TO_OWNER"); updateConfig("contactCustomAssignment", null) }}
                        label="Assign to Contact's owner"
                        description="Assign the lead to the matched contact's current owner"
                      />
                      <MatchRadioOption
                        id="flow-contactMatch-custom"
                        name="flow-contactMatch"
                        value="ASSIGN_CUSTOM"
                        checked={config.onContactMatch === "ASSIGN_CUSTOM"}
                        onChange={() => {
                          updateConfig("onContactMatch", "ASSIGN_CUSTOM")
                          updateConfig("contactCustomAssignment", { assignmentType: "USER", assigneeId: "", assigneeName: "" })
                        }}
                        label="Assign to..."
                        description="Choose a specific user, team, or queue"
                      />
                      {config.onContactMatch === "ASSIGN_CUSTOM" && (
                        <div className="ml-6 mt-2">
                          <AssigneeSelect
                            assignmentType={(config.contactCustomAssignment as any)?.assignmentType ?? "USER"}
                            assigneeId={(config.contactCustomAssignment as any)?.assigneeId ?? ""}
                            onTypeChange={(type: AssignmentType) =>
                              updateConfig("contactCustomAssignment", { assignmentType: type, assigneeId: "", assigneeName: "" })
                            }
                            onAssigneeChange={(id: string) =>
                              updateConfig("contactCustomAssignment", {
                                ...((config.contactCustomAssignment as any) ?? { assignmentType: "USER", assigneeName: "" }),
                                assigneeId: id,
                              })
                            }
                          />
                        </div>
                      )}
                      <MatchRadioOption
                        id="flow-contactMatch-skip"
                        name="flow-contactMatch"
                        value="SKIP"
                        checked={config.onContactMatch === "SKIP"}
                        onChange={() => { updateConfig("onContactMatch", "SKIP"); updateConfig("contactCustomAssignment", null) }}
                        label="Skip routing"
                        description="Do not route this lead if a contact match is found"
                      />
                    </div>
                  </section>
                )}

                {/* When Account matched */}
                {!!config.checkAccounts && (
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      When an Account is matched
                    </h3>
                    <div className="space-y-2">
                      <MatchRadioOption
                        id="flow-accountMatch-owner"
                        name="flow-accountMatch"
                        value="ASSIGN_TO_OWNER"
                        checked={(config.onAccountMatch ?? "ASSIGN_TO_OWNER") === "ASSIGN_TO_OWNER"}
                        onChange={() => { updateConfig("onAccountMatch", "ASSIGN_TO_OWNER"); updateConfig("accountCustomAssignment", null) }}
                        label="Assign to Account's owner"
                        description="Assign the lead to the matched account's current owner"
                      />
                      <MatchRadioOption
                        id="flow-accountMatch-custom"
                        name="flow-accountMatch"
                        value="ASSIGN_CUSTOM"
                        checked={config.onAccountMatch === "ASSIGN_CUSTOM"}
                        onChange={() => {
                          updateConfig("onAccountMatch", "ASSIGN_CUSTOM")
                          updateConfig("accountCustomAssignment", { assignmentType: "USER", assigneeId: "", assigneeName: "" })
                        }}
                        label="Assign to..."
                        description="Choose a specific user, team, or queue"
                      />
                      {config.onAccountMatch === "ASSIGN_CUSTOM" && (
                        <div className="ml-6 mt-2">
                          <AssigneeSelect
                            assignmentType={(config.accountCustomAssignment as any)?.assignmentType ?? "USER"}
                            assigneeId={(config.accountCustomAssignment as any)?.assigneeId ?? ""}
                            onTypeChange={(type: AssignmentType) =>
                              updateConfig("accountCustomAssignment", { assignmentType: type, assigneeId: "", assigneeName: "" })
                            }
                            onAssigneeChange={(id: string) =>
                              updateConfig("accountCustomAssignment", {
                                ...((config.accountCustomAssignment as any) ?? { assignmentType: "USER", assigneeName: "" }),
                                assigneeId: id,
                              })
                            }
                          />
                        </div>
                      )}
                      <MatchRadioOption
                        id="flow-accountMatch-skip"
                        name="flow-accountMatch"
                        value="SKIP"
                        checked={config.onAccountMatch === "SKIP"}
                        onChange={() => { updateConfig("onAccountMatch", "SKIP"); updateConfig("accountCustomAssignment", null) }}
                        label="Skip routing"
                        description="Do not route this lead if an account match is found"
                      />
                    </div>
                  </section>
                )}
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
                  <label className={labelClass}>Branch Field (optional)</label>
                  <select value={config.fieldApiName ?? ""} onChange={e => updateConfig("fieldApiName", e.target.value)} className={selectClass}>
                    <option value="">None (use conditions only)</option>
                    {fields.map(f => <option key={f.fieldApiName} value={f.fieldApiName}>{f.fieldLabel}</option>)}
                  </select>
                  <p className="text-[11px] text-zinc-400 mt-1">Visual hint only — each branch defines its own conditions below.</p>
                </div>
                <div>
                  <label className={labelClass}>Branches</label>
                  <div className="space-y-4 mt-2">
                    {(config.branches ?? []).map((b: any, i: number) => (
                      <div key={i} className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <input
                            value={b.label ?? ""}
                            onChange={e => {
                              const branches = [...(config.branches ?? [])]
                              branches[i] = { ...branches[i], label: e.target.value }
                              updateConfig("branches", branches)
                            }}
                            placeholder={`Branch ${i + 1}`}
                            className="flex-1 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-700 outline-none bg-white"
                          />
                          <button onClick={() => updateConfig("branches", (config.branches ?? []).filter((_: any, j: number) => j !== i))} className="text-zinc-300 hover:text-red-400 text-xs">✕</button>
                        </div>
                        <div>
                          <label className={labelClass}>Conditions</label>
                          <ConditionBuilder
                            fields={fields}
                            value={b.conditions ?? []}
                            onChange={(c: ConditionGroup[]) => {
                              const branches = [...(config.branches ?? [])]
                              branches[i] = { ...branches[i], conditions: c }
                              updateConfig("branches", branches)
                            }}
                          />
                        </div>
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
