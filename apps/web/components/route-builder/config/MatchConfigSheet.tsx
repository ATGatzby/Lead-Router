"use client"

import { useState } from "react"
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
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { AssigneeSelect } from "@/components/rule-form/AssigneeSelect"
import { cn } from "@/lib/utils"
import type {
  MatchConfig,
  FuzzyMatchMode,
  LeadMatchAction,
  ContactMatchAction,
  AccountMatchAction,
  AssignmentType,
} from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  matchConfig: MatchConfig
  onSave: (config: MatchConfig) => void
}

function defaultMatchConfig(): MatchConfig {
  return {
    checkLeads: true,
    checkContacts: false,
    checkAccounts: false,
    matchEmail: true,
    matchPhone: false,
    matchDomain: false,
    matchCompanyName: false,
    fuzzyMatchMode: "STRICT",
    onLeadMatch: "SFDC_MERGE",
    leadCustomAssignment: null,
    onContactMatch: "ASSIGN_TO_OWNER",
    contactCustomAssignment: null,
    onAccountMatch: "ASSIGN_TO_OWNER",
    accountCustomAssignment: null,
  }
}

interface RadioOptionProps {
  id: string
  name: string
  value: string
  checked: boolean
  onChange: () => void
  label: string
  description?: string
  recommended?: boolean
}

function RadioOption({ id, name, value, checked, onChange, label, description, recommended }: RadioOptionProps) {
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
            <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
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

function CheckField({
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

export function MatchConfigSheet({ open, onOpenChange, matchConfig, onSave }: Props) {
  const [cfg, setCfg] = useState<MatchConfig>(matchConfig)

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) setCfg(matchConfig)
    onOpenChange(isOpen)
  }

  const patch = (updates: Partial<MatchConfig>) => setCfg((prev) => ({ ...prev, ...updates }))

  const handleSave = () => {
    onSave(cfg)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Configure Match Action</SheetTitle>
          <SheetDescription>
            Check for existing Salesforce records before routing and decide what to do when a match is found.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          {/* ── Check against ─────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Check against existing records
            </h3>
            <div className="space-y-2.5">
              <CheckField
                id="checkLeads"
                label="Existing Leads"
                description="Match against leads with the same email or phone"
                checked={cfg.checkLeads}
                onChange={(v) => patch({ checkLeads: v })}
              />
              <CheckField
                id="checkContacts"
                label="Existing Contacts"
                description="Match against contacts with the same email or phone"
                checked={cfg.checkContacts}
                onChange={(v) => patch({ checkContacts: v })}
              />
              <CheckField
                id="checkAccounts"
                label="Existing Accounts"
                description="Match against accounts by company domain"
                checked={cfg.checkAccounts}
                onChange={(v) => patch({ checkAccounts: v })}
              />
            </div>
          </section>

          {/* ── Match on ──────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Match on
            </h3>
            <div className="space-y-2.5">
              <CheckField
                id="matchEmail"
                label="Email address (exact)"
                checked={cfg.matchEmail}
                onChange={(v) => patch({ matchEmail: v })}
              />
              <CheckField
                id="matchPhone"
                label="Phone number (normalized)"
                description="Strips formatting before comparing"
                checked={cfg.matchPhone}
                onChange={(v) => patch({ matchPhone: v })}
              />
              <CheckField
                id="matchDomain"
                label="Company domain"
                description="Extracts domain from email, matches against Account website"
                checked={cfg.matchDomain}
                onChange={(v) => patch({ matchDomain: v })}
              />
              <CheckField
                id="matchCompanyName"
                label="Company name"
                description="Match against Account name using the selected strategy"
                checked={cfg.matchCompanyName}
                onChange={(v) => patch({ matchCompanyName: v })}
              />
              {cfg.matchCompanyName && (
                <div className="ml-7 space-y-2">
                  <RadioOption
                    id="fuzzy-strict"
                    name="fuzzyMatchMode"
                    value="STRICT"
                    checked={cfg.fuzzyMatchMode === "STRICT"}
                    onChange={() => patch({ fuzzyMatchMode: "STRICT" })}
                    label="Strict"
                    description="Exact company name match (normalized)"
                    recommended
                  />
                  <RadioOption
                    id="fuzzy-fuzzy"
                    name="fuzzyMatchMode"
                    value="FUZZY"
                    checked={cfg.fuzzyMatchMode === "FUZZY"}
                    onChange={() => patch({ fuzzyMatchMode: "FUZZY" })}
                    label="Fuzzy"
                    description="String similarity + known abbreviations (e.g. Corp vs Corporation)"
                  />
                  <RadioOption
                    id="fuzzy-ai"
                    name="fuzzyMatchMode"
                    value="AI_SMART"
                    checked={cfg.fuzzyMatchMode === "AI_SMART"}
                    onChange={() => patch({ fuzzyMatchMode: "AI_SMART" })}
                    label="AI Smart"
                    description="Semantic matching with AI fallback for ambiguous names"
                  />
                </div>
              )}
            </div>
          </section>

          {/* ── When Lead matched ─────────────────────────────────── */}
          {cfg.checkLeads && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                When a Lead is matched
              </h3>
              <div className="space-y-2">
                <RadioOption
                  id="leadMatch-merge"
                  name="leadMatch"
                  value="SFDC_MERGE"
                  checked={cfg.onLeadMatch === "SFDC_MERGE"}
                  onChange={() => patch({ onLeadMatch: "SFDC_MERGE", leadCustomAssignment: null })}
                  label="Salesforce Lead Merge"
                  description="Merge this lead into the existing lead"
                  recommended
                />
                <RadioOption
                  id="leadMatch-owner"
                  name="leadMatch"
                  value="ASSIGN_TO_OWNER"
                  checked={cfg.onLeadMatch === "ASSIGN_TO_OWNER"}
                  onChange={() => patch({ onLeadMatch: "ASSIGN_TO_OWNER", leadCustomAssignment: null })}
                  label="Assign to lead's owner"
                  description="Assign the new lead to the matched lead's current owner"
                />
                <RadioOption
                  id="leadMatch-custom"
                  name="leadMatch"
                  value="ASSIGN_CUSTOM"
                  checked={cfg.onLeadMatch === "ASSIGN_CUSTOM"}
                  onChange={() =>
                    patch({
                      onLeadMatch: "ASSIGN_CUSTOM",
                      leadCustomAssignment: { assignmentType: "USER", assigneeId: "", assigneeName: "" },
                    })
                  }
                  label="Assign to…"
                  description="Choose a specific user, team, or queue"
                />
                {cfg.onLeadMatch === "ASSIGN_CUSTOM" && (
                  <div className="ml-6 mt-2">
                    <AssigneeSelect
                      assignmentType={cfg.leadCustomAssignment?.assignmentType ?? "USER"}
                      assigneeId={cfg.leadCustomAssignment?.assigneeId ?? ""}
                      onTypeChange={(type: AssignmentType) =>
                        patch({
                          leadCustomAssignment: {
                            assignmentType: type,
                            assigneeId: "",
                            assigneeName: "",
                          },
                        })
                      }
                      onAssigneeChange={(id: string) =>
                        patch({
                          leadCustomAssignment: {
                            ...(cfg.leadCustomAssignment ?? { assignmentType: "USER", assigneeName: "" }),
                            assigneeId: id,
                          },
                        })
                      }
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── When Contact matched ─────────────────────────────── */}
          {cfg.checkContacts && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                When a Contact is matched
              </h3>
              <div className="space-y-2">
                <RadioOption
                  id="contactMatch-owner"
                  name="contactMatch"
                  value="ASSIGN_TO_OWNER"
                  checked={cfg.onContactMatch === "ASSIGN_TO_OWNER"}
                  onChange={() => patch({ onContactMatch: "ASSIGN_TO_OWNER", contactCustomAssignment: null })}
                  label="Assign to Contact's owner"
                  description="Assign the lead to the matched contact's current owner"
                />
                <RadioOption
                  id="contactMatch-custom"
                  name="contactMatch"
                  value="ASSIGN_CUSTOM"
                  checked={cfg.onContactMatch === "ASSIGN_CUSTOM"}
                  onChange={() =>
                    patch({
                      onContactMatch: "ASSIGN_CUSTOM",
                      contactCustomAssignment: { assignmentType: "USER", assigneeId: "", assigneeName: "" },
                    })
                  }
                  label="Assign to…"
                  description="Choose a specific user, team, or queue"
                />
                {cfg.onContactMatch === "ASSIGN_CUSTOM" && (
                  <div className="ml-6 mt-2">
                    <AssigneeSelect
                      assignmentType={cfg.contactCustomAssignment?.assignmentType ?? "USER"}
                      assigneeId={cfg.contactCustomAssignment?.assigneeId ?? ""}
                      onTypeChange={(type: AssignmentType) =>
                        patch({
                          contactCustomAssignment: {
                            assignmentType: type,
                            assigneeId: "",
                            assigneeName: "",
                          },
                        })
                      }
                      onAssigneeChange={(id: string) =>
                        patch({
                          contactCustomAssignment: {
                            ...(cfg.contactCustomAssignment ?? { assignmentType: "USER", assigneeName: "" }),
                            assigneeId: id,
                          },
                        })
                      }
                    />
                  </div>
                )}
                <RadioOption
                  id="contactMatch-skip"
                  name="contactMatch"
                  value="SKIP"
                  checked={cfg.onContactMatch === "SKIP"}
                  onChange={() => patch({ onContactMatch: "SKIP", contactCustomAssignment: null })}
                  label="Skip routing"
                  description="Do not route this lead if a contact match is found"
                />
              </div>
            </section>
          )}

          {/* ── When Account matched ─────────────────────────────── */}
          {cfg.checkAccounts && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                When an Account is matched
              </h3>
              <div className="space-y-2">
                <RadioOption
                  id="accountMatch-owner"
                  name="accountMatch"
                  value="ASSIGN_TO_OWNER"
                  checked={cfg.onAccountMatch === "ASSIGN_TO_OWNER"}
                  onChange={() => patch({ onAccountMatch: "ASSIGN_TO_OWNER", accountCustomAssignment: null })}
                  label="Assign to Account's owner"
                  description="Assign the lead to the matched account's current owner"
                />
                <RadioOption
                  id="accountMatch-custom"
                  name="accountMatch"
                  value="ASSIGN_CUSTOM"
                  checked={cfg.onAccountMatch === "ASSIGN_CUSTOM"}
                  onChange={() =>
                    patch({
                      onAccountMatch: "ASSIGN_CUSTOM",
                      accountCustomAssignment: { assignmentType: "USER", assigneeId: "", assigneeName: "" },
                    })
                  }
                  label="Assign to…"
                  description="Choose a specific user, team, or queue"
                />
                {cfg.onAccountMatch === "ASSIGN_CUSTOM" && (
                  <div className="ml-6 mt-2">
                    <AssigneeSelect
                      assignmentType={cfg.accountCustomAssignment?.assignmentType ?? "USER"}
                      assigneeId={cfg.accountCustomAssignment?.assigneeId ?? ""}
                      onTypeChange={(type: AssignmentType) =>
                        patch({
                          accountCustomAssignment: {
                            assignmentType: type,
                            assigneeId: "",
                            assigneeName: "",
                          },
                        })
                      }
                      onAssigneeChange={(id: string) =>
                        patch({
                          accountCustomAssignment: {
                            ...(cfg.accountCustomAssignment ?? { assignmentType: "USER", assigneeName: "" }),
                            assigneeId: id,
                          },
                        })
                      }
                    />
                  </div>
                )}
                <RadioOption
                  id="accountMatch-skip"
                  name="accountMatch"
                  value="SKIP"
                  checked={cfg.onAccountMatch === "SKIP"}
                  onChange={() => patch({ onAccountMatch: "SKIP", accountCustomAssignment: null })}
                  label="Skip routing"
                  description="Do not route this lead if an account match is found"
                />
              </div>
            </section>
          )}
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { defaultMatchConfig }
