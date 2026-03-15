"use client"

import { useState, useRef, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
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
import type { RuleConditions, FieldSchema } from "@/components/condition-builder"
import type { ObjectType } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  pathLabel: string
  conditions: RuleConditions
  objectType: ObjectType
  onSave: (conditions: RuleConditions) => void
  onLabelChange?: (label: string) => void
}

interface FieldsResponse {
  fields: FieldSchema[]
}

export function FilterConfigSheet({
  open,
  onOpenChange,
  pathLabel,
  conditions,
  objectType,
  onSave,
  onLabelChange,
}: Props) {
  const [localConditions, setLocalConditions] = useState<RuleConditions>(conditions)
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const labelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditingLabel && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
    }
  }, [isEditingLabel])

  const commitLabel = () => {
    const val = labelInputRef.current?.value.trim()
    if (val && val !== pathLabel && onLabelChange) {
      onLabelChange(val)
    }
    setIsEditingLabel(false)
  }

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

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) setLocalConditions(conditions)
    onOpenChange(isOpen)
  }

  const handleSave = () => {
    onSave(localConditions)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>Filter Conditions —</span>
            {isEditingLabel ? (
              <input
                ref={labelInputRef}
                defaultValue={pathLabel}
                className="text-lg font-semibold bg-transparent border-b border-primary outline-none w-40"
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitLabel()
                  if (e.key === "Escape") setIsEditingLabel(false)
                }}
              />
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 hover:text-primary transition-colors group"
                onClick={() => setIsEditingLabel(true)}
              >
                {pathLabel}
                <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </SheetTitle>
          <SheetDescription>
            Records matching all condition groups will be routed to this path. Leave empty to make
            this a catch-all path.
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          {fieldsQuery.isLoading && (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Loading fields…
            </div>
          )}
          {fieldsQuery.isSuccess && fields.length === 0 && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 mb-4">
              No fields synced yet. Use &quot;Sync Fields&quot; on the routing rules list to import fields from
              Salesforce.
            </div>
          )}
          <ConditionBuilder
            value={localConditions}
            onChange={setLocalConditions}
            fields={fields}
          />
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save Conditions
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
