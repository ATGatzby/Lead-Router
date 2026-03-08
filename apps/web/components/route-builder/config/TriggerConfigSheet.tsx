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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { RouteBuilderState, ObjectType, TriggerEvent } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: RouteBuilderState["trigger"]
  onSave: (trigger: RouteBuilderState["trigger"]) => void
}

export function TriggerConfigSheet({ open, onOpenChange, trigger, onSave }: Props) {
  const [objectType, setObjectType] = useState<ObjectType>(trigger.objectType)
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>(trigger.triggerEvent)
  const [isDryRun, setIsDryRun] = useState(trigger.isDryRun)

  // Keep local state in sync when sheet re-opens with new trigger
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setObjectType(trigger.objectType)
      setTriggerEvent(trigger.triggerEvent)
      setIsDryRun(trigger.isDryRun)
    }
    onOpenChange(isOpen)
  }

  const handleSave = () => {
    onSave({ objectType, triggerEvent, isDryRun })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Configure Trigger</SheetTitle>
          <SheetDescription>
            Choose which Salesforce object and event fires this route.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          {/* Object type */}
          <div className="space-y-1.5">
            <Label htmlFor="trigger-object">Salesforce object</Label>
            <Select
              value={objectType}
              onValueChange={(v) => setObjectType(v as ObjectType)}
            >
              <SelectTrigger id="trigger-object" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LEAD">Lead</SelectItem>
                <SelectItem value="CONTACT">Contact</SelectItem>
                <SelectItem value="ACCOUNT">Account</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trigger event */}
          <div className="space-y-2">
            <Label>Trigger event</Label>
            <div className="space-y-2">
              {(
                [
                  { value: "INSERT", label: "Lead Created", description: "Fires when a new record is created" },
                  { value: "UPDATE", label: "Lead Updated", description: "Fires when an existing record is updated" },
                  { value: "BOTH", label: "Any Lead Change", description: "Fires on both create and update" },
                ] as { value: TriggerEvent; label: string; description: string }[]
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    triggerEvent === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="triggerEvent"
                    value={opt.value}
                    checked={triggerEvent === opt.value}
                    onChange={() => setTriggerEvent(opt.value)}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Dry run */}
          <div className="rounded-lg border border-border p-4 space-y-1">
            <div className="flex items-center gap-3">
              <Checkbox
                id="dry-run"
                checked={isDryRun}
                onCheckedChange={(checked) => setIsDryRun(!!checked)}
              />
              <Label htmlFor="dry-run" className="cursor-pointer font-medium">
                Dry run mode
              </Label>
            </div>
            <p className="text-xs text-muted-foreground ml-7">
              Evaluate and log results without making assignments in Salesforce. Useful for testing.
            </p>
          </div>
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
