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
import type { PathAction, AssignmentType } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  pathLabel: string
  action: PathAction
  onSave: (action: PathAction) => void
}

export function ActionConfigSheet({
  open,
  onOpenChange,
  pathLabel,
  action,
  onSave,
}: Props) {
  const [assignmentType, setAssignmentType] = useState<AssignmentType>(
    action.assignmentType ?? "USER"
  )
  const [assigneeId, setAssigneeId] = useState<string>(action.assigneeId ?? "")

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setAssignmentType(action.assignmentType ?? "USER")
      setAssigneeId(action.assigneeId ?? "")
    }
    onOpenChange(isOpen)
  }

  const handleSave = () => {
    onSave({
      assignmentType,
      assigneeId: assigneeId || null,
      assigneeName: null, // resolved lazily from display
    })
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
          <SheetTitle>Assign Lead — {pathLabel}</SheetTitle>
          <SheetDescription>
            Choose who to assign leads that are routed to this path.
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          <AssigneeSelect
            assignmentType={assignmentType}
            assigneeId={assigneeId}
            onTypeChange={handleTypeChange}
            onAssigneeChange={setAssigneeId}
          />
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!assigneeId}
          >
            Save Assignment
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
