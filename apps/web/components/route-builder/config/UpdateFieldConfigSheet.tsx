"use client"

import { useState, useEffect, useRef } from "react"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Pencil, Plus, Trash2, Search, ChevronDown } from "lucide-react"
import type { FieldSchema } from "@/components/condition-builder"
import type { FieldUpdate } from "../types"
import { useCrmType } from "@/lib/hooks/use-crm-type"

interface FieldsResponse {
  fields: FieldSchema[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fieldUpdates: FieldUpdate[]
  objectType: string
  onSave: (fieldUpdates: FieldUpdate[]) => void
}

const MAX_FIELD_UPDATES = 10

const FIELD_TYPE_COLORS: Record<string, { text: string; bg: string; label: string }> = {
  PICKLIST: { text: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950", label: "Picklist" },
  MULTI_PICKLIST: { text: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950", label: "Multi" },
  TEXT: { text: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950", label: "Text" },
  NUMBER: { text: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950", label: "Number" },
  BOOLEAN: { text: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950", label: "Bool" },
  DATE: { text: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950", label: "Date" },
  DATETIME: { text: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950", label: "DateTime" },
}

function TypeBadge({ fieldType }: { fieldType: string }) {
  const config = FIELD_TYPE_COLORS[fieldType] ?? FIELD_TYPE_COLORS.TEXT
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${config.text} ${config.bg}`}>
      {config.label}
    </span>
  )
}

export function UpdateFieldConfigSheet({
  open,
  onOpenChange,
  fieldUpdates: initialFieldUpdates,
  objectType,
  onSave,
}: Props) {
  const [updates, setUpdates] = useState<FieldUpdate[]>(initialFieldUpdates)
  const [openDropdownIndex, setOpenDropdownIndex] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { crmLabel } = useCrmType()

  // Fetch fields for the object type
  const fieldsQuery = useQuery<FieldsResponse>({
    queryKey: ["fields", objectType],
    queryFn: async () => {
      const res = await fetch(`/api/fields?object=${objectType}`)
      if (!res.ok) throw new Error("Failed to load fields")
      return res.json()
    },
    enabled: open,
  })

  const fields = fieldsQuery.data?.fields ?? []

  // Reset state when sheet opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setUpdates(initialFieldUpdates)
      setOpenDropdownIndex(null)
      setSearchQuery("")
    }
    onOpenChange(isOpen)
  }

  // Focus search input when dropdown opens
  useEffect(() => {
    if (openDropdownIndex !== null) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [openDropdownIndex])

  const handleSave = () => {
    // Filter out empty rows
    const validUpdates = updates.filter((u) => u.fieldApiName && u.fieldValue)
    onSave(validUpdates)
    onOpenChange(false)
  }

  const addRow = () => {
    if (updates.length >= MAX_FIELD_UPDATES) return
    setUpdates([...updates, { fieldApiName: "", fieldLabel: "", fieldType: "TEXT", fieldValue: "" }])
  }

  const removeRow = (index: number) => {
    setUpdates(updates.filter((_, i) => i !== index))
  }

  const selectField = (index: number, field: FieldSchema) => {
    const newUpdates = [...updates]
    newUpdates[index] = {
      fieldApiName: field.fieldApiName,
      fieldLabel: field.fieldLabel,
      fieldType: field.fieldType,
      fieldValue: "",
      picklistValues: field.picklistValues as string[] | undefined,
    }
    setUpdates(newUpdates)
    setOpenDropdownIndex(null)
    setSearchQuery("")
  }

  const updateValue = (index: number, value: string) => {
    const newUpdates = [...updates]
    newUpdates[index] = { ...newUpdates[index], fieldValue: value }
    setUpdates(newUpdates)
  }

  // Filter fields for dropdown — exclude already-selected fields
  const selectedApiNames = new Set(updates.map((u) => u.fieldApiName).filter(Boolean))
  const filteredFields = fields.filter((f) => {
    if (selectedApiNames.has(f.fieldApiName) && updates[openDropdownIndex ?? -1]?.fieldApiName !== f.fieldApiName) return false
    if (!searchQuery) return true
    return (
      f.fieldLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.fieldApiName.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })

  const hasValidUpdates = updates.some((u) => u.fieldApiName && u.fieldValue)

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-yellow-600" />
            Update Fields
          </SheetTitle>
          <SheetDescription>
            Set field values on the record before routing continues.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {/* Loading state */}
          {fieldsQuery.isLoading && (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Loading fields...
            </div>
          )}

          {/* No fields synced warning */}
          {fieldsQuery.isSuccess && fields.length === 0 && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              No fields synced yet. Go to Integrations and use &quot;Sync Fields&quot; to import fields from {crmLabel}.
            </div>
          )}

          {/* Field count */}
          {fields.length > 0 && (
            <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Field updates</span>
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {updates.length} / {MAX_FIELD_UPDATES}
              </span>
            </div>
          )}

          {/* Empty state */}
          {updates.length === 0 && fields.length > 0 && (
            <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
              <Pencil className="h-6 w-6 mx-auto mb-3 text-border" />
              <p className="text-sm">
                No field updates configured.<br />
                Click <span className="font-semibold text-foreground">+ Add Field Update</span> to set values on the record.
              </p>
            </div>
          )}

          {/* Field update rows */}
          <div className="space-y-2">
            {updates.map((update, index) => (
              <div
                key={index}
                className="group bg-muted/30 border border-border rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors relative"
              >
                {/* Top row: field selector + delete */}
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-border text-muted-foreground text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                    {index + 1}
                  </span>

                  {/* Field selector */}
                  <div className="relative flex-1">
                    <button
                      type="button"
                      className={`w-full flex items-center gap-2 bg-background border rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                        openDropdownIndex === index
                          ? "border-primary ring-2 ring-primary/10"
                          : "border-border hover:border-muted-foreground/30"
                      }`}
                      onClick={() => {
                        setOpenDropdownIndex(openDropdownIndex === index ? null : index)
                        setSearchQuery("")
                      }}
                    >
                      <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className={`flex-1 truncate ${update.fieldLabel ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {update.fieldLabel || "Select field..."}
                      </span>
                      {update.fieldType && update.fieldApiName && (
                        <TypeBadge fieldType={update.fieldType} />
                      )}
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform ${openDropdownIndex === index ? "rotate-180" : ""}`} />
                    </button>

                    {/* Dropdown */}
                    {openDropdownIndex === index && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                        {/* Search input */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                          <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <input
                            ref={searchInputRef}
                            type="text"
                            className="flex-1 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground"
                            placeholder="Search fields..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                        </div>

                        {/* Field list */}
                        <div className="max-h-[240px] overflow-y-auto p-1">
                          {filteredFields.length === 0 && (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                              No matching fields
                            </div>
                          )}
                          {filteredFields.map((field) => (
                            <button
                              key={field.fieldApiName}
                              type="button"
                              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm transition-colors ${
                                update.fieldApiName === field.fieldApiName
                                  ? "bg-primary/10"
                                  : "hover:bg-muted"
                              }`}
                              onClick={() => selectField(index, field)}
                            >
                              <span className="flex-1 truncate">{field.fieldLabel}</span>
                              <span className="text-[11px] text-muted-foreground font-mono">{field.fieldApiName}</span>
                              <TypeBadge fieldType={field.fieldType} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Delete button */}
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all flex-shrink-0"
                    onClick={() => removeRow(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Bottom row: value input */}
                {update.fieldApiName && (
                  <div className="flex items-center gap-2 pl-6">
                    <svg className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 5 7 7-7 7"/></svg>

                    {/* Picklist → Select */}
                    {(update.fieldType === "PICKLIST" || update.fieldType === "MULTI_PICKLIST") && update.picklistValues?.length ? (
                      <Select value={update.fieldValue} onValueChange={(val) => updateValue(index, val)}>
                        <SelectTrigger className="flex-1 h-8 text-sm">
                          <SelectValue placeholder="Select value..." />
                        </SelectTrigger>
                        <SelectContent>
                          {update.picklistValues.map((v) => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : update.fieldType === "BOOLEAN" ? (
                      /* Boolean → Switch */
                      <div className="flex items-center gap-2 flex-1">
                        <Switch
                          checked={update.fieldValue === "true"}
                          onCheckedChange={(checked) => updateValue(index, String(checked))}
                        />
                        <span className="text-sm font-medium">
                          {update.fieldValue === "true" ? "True" : "False"}
                        </span>
                      </div>
                    ) : update.fieldType === "DATE" || update.fieldType === "DATETIME" ? (
                      /* Date → Select with presets OR custom input */
                      update.fieldValue && update.fieldValue !== "TODAY" && update.fieldValue !== "NOW" ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            type={update.fieldType === "DATETIME" ? "datetime-local" : "date"}
                            className="flex-1 h-8 text-sm"
                            value={update.fieldValue}
                            onChange={(e) => updateValue(index, e.target.value)}
                          />
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-primary"
                            onClick={() => updateValue(index, "TODAY")}
                          >
                            Presets
                          </button>
                        </div>
                      ) : (
                        <Select value={update.fieldValue || "TODAY"} onValueChange={(val) => {
                          if (val === "CUSTOM") {
                            updateValue(index, new Date().toISOString().split("T")[0])
                          } else {
                            updateValue(index, val)
                          }
                        }}>
                          <SelectTrigger className="flex-1 h-8 text-sm">
                            <SelectValue placeholder="Select date..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TODAY">Today (current date)</SelectItem>
                            <SelectItem value="NOW">Now (current datetime)</SelectItem>
                            <SelectItem value="CUSTOM">Custom date...</SelectItem>
                          </SelectContent>
                        </Select>
                      )
                    ) : update.fieldType === "NUMBER" ? (
                      /* Number → Number input */
                      <Input
                        type="number"
                        className="flex-1 h-8 text-sm"
                        value={update.fieldValue}
                        onChange={(e) => updateValue(index, e.target.value)}
                        placeholder="Enter number..."
                      />
                    ) : (
                      /* Text → Text input */
                      <Input
                        className="flex-1 h-8 text-sm"
                        value={update.fieldValue}
                        onChange={(e) => updateValue(index, e.target.value)}
                        placeholder="Enter value..."
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add button */}
          {fields.length > 0 && updates.length < MAX_FIELD_UPDATES && (
            <button
              type="button"
              className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-border rounded-lg text-sm font-medium text-muted-foreground hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors"
              onClick={addRow}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Field Update
            </button>
          )}
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!hasValidUpdates && updates.length > 0}>
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
