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
import { AssigneeSelect } from "@/components/rule-form/AssigneeSelect"
import type { DefaultOwner, AssignmentType } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultOwner: DefaultOwner | null
  onSave: (owner: DefaultOwner) => void
  onClear: () => void
}

export function DefaultOwnerConfigSheet({
  open,
  onOpenChange,
  defaultOwner,
  onSave,
  onClear,
}: Props) {
  const [assignmentType, setAssignmentType] = useState<AssignmentType>(
    defaultOwner?.assignmentType ?? "USER"
  )
  const [assigneeId, setAssigneeId] = useState<string>(defaultOwner?.assigneeId ?? "")

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setAssignmentType(defaultOwner?.assignmentType ?? "USER")
      setAssigneeId(defaultOwner?.assigneeId ?? "")
    }
    onOpenChange(isOpen)
  }

  const handleSave = () => {
    onSave({
      assignmentType,
      assigneeId,
      assigneeName: "",
    })
    onOpenChange(false)
  }

  const handleClear = () => {
    onClear()
    onOpenChange(false)
  }

  const handleTypeChange = (type: AssignmentType) => {
    setAssignmentType(type)
    setAssigneeId("")
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Default Owner</SheetTitle>
          <SheetDescription>
            The fallback assignee for leads that do not match any path. Without a default owner,
            unmatched leads will not be re-assigned.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            This owner receives leads when no path conditions match. It is strongly recommended to
            configure a default owner to prevent leads from going unassigned.
          </div>

          <AssigneeSelect
            assignmentType={assignmentType}
            assigneeId={assigneeId}
            onTypeChange={handleTypeChange}
            onAssigneeChange={setAssigneeId}
          />
        </SheetBody>

        <SheetFooter className="flex-col sm:flex-row gap-2">
          {defaultOwner && (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive sm:mr-auto"
              onClick={handleClear}
            >
              Remove default owner
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!assigneeId}>
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
