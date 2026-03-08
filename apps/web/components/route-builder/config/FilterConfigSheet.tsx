"use client"

import { useState } from "react"
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
import type { RuleConditions, FieldSchema } from "@/components/condition-builder"
import type { ObjectType } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  pathLabel: string
  conditions: RuleConditions
  objectType: ObjectType
  onSave: (conditions: RuleConditions) => void
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
}: Props) {
  const [localConditions, setLocalConditions] = useState<RuleConditions>(conditions)

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
          <SheetTitle>Filter Conditions — {pathLabel}</SheetTitle>
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
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 mb-4">
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
