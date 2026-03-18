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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface TaskConfig {
  subject: string
  priority: string
  status: string
  dueDateOffset: number | null
  description: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: TaskConfig
  onSave: (config: TaskConfig) => void
}

export function CreateTaskConfigSheet({
  open,
  onOpenChange,
  config,
  onSave,
}: Props) {
  const [localConfig, setLocalConfig] = useState<TaskConfig>(config)

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setLocalConfig(config)
    }
    onOpenChange(isOpen)
  }

  const update = <K extends keyof TaskConfig>(key: K, value: TaskConfig[K]) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    onSave(localConfig)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Create Task</SheetTitle>
          <SheetDescription>
            Create a follow-up task in Salesforce when a record is routed to this
            path.
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                value={localConfig.subject}
                onChange={(e) => update("subject", e.target.value)}
                placeholder="Follow up with new lead"
              />
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={localConfig.priority}
                onValueChange={(val) => update("priority", val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={localConfig.status}
                onValueChange={(val) => update("status", val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Not Started">Not Started</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Due in (days)</Label>
              <Input
                type="number"
                value={localConfig.dueDateOffset ?? ""}
                onChange={(e) =>
                  update(
                    "dueDateOffset",
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                placeholder="No due date"
                min={0}
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={localConfig.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Task description..."
                rows={4}
              />
            </div>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!localConfig.subject}
          >
            Save Task
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
