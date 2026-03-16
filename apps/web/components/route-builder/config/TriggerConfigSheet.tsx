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
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Filter } from "lucide-react"
import { ConditionBuilder } from "@/components/condition-builder"
import type { ConditionGroup, FieldSchema } from "@/components/condition-builder/types"
import type { TriggerConfig, ObjectType, TriggerEvent } from "../types"
import { AITriggerGenerator } from "./AITriggerGenerator"

interface FieldsResponse {
  fields: FieldSchema[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: TriggerConfig
  onSave: (trigger: TriggerConfig) => void
}

const aiEnabled = true

export function TriggerConfigSheet({ open, onOpenChange, trigger, onSave }: Props) {
  const [triggerName, setTriggerName] = useState(trigger.triggerName)
  const [objectType, setObjectType] = useState<ObjectType>(trigger.objectType)
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>(trigger.triggerEvent)
  const [isDryRun, setIsDryRun] = useState(trigger.isDryRun)
  const [triggerConditions, setTriggerConditions] = useState<ConditionGroup[]>(
    trigger.triggerConditions
  )

  // Fetch license tier to gate Contact/Account behind Pro
  const licenseQuery = useQuery({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license")
      if (!res.ok) return { tier: "free" }
      return res.json()
    },
  })
  const tier = licenseQuery.data?.tier ?? "free"
  const isFreeTier = tier === "free"

  // Fetch fields for the selected object type (for ConditionBuilder)
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

  // Keep local state in sync when sheet re-opens with new trigger
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setTriggerName(trigger.triggerName)
      setObjectType(trigger.objectType)
      setTriggerEvent(trigger.triggerEvent)
      setIsDryRun(trigger.isDryRun)
      setTriggerConditions(trigger.triggerConditions)
    }
    onOpenChange(isOpen)
  }

  const handleSave = () => {
    onSave({ triggerName, objectType, triggerEvent, isDryRun, triggerConditions })
    onOpenChange(false)
  }

  const handleApplyAITrigger = (aiTrigger: {
    objectType: ObjectType
    triggerEvent: TriggerEvent
    triggerConditions: ConditionGroup[]
  }) => {
    setObjectType(aiTrigger.objectType)
    setTriggerEvent(aiTrigger.triggerEvent)
    setTriggerConditions(aiTrigger.triggerConditions)
  }

  const criteriaCount = triggerConditions.flatMap((g) => g.conditions).length

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[50vw]">
        <SheetHeader>
          <SheetTitle>Configure Trigger</SheetTitle>
          <SheetDescription>
            Choose which Salesforce object and event fires this route.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          {aiEnabled && (
            <>
              <AITriggerGenerator
                objectType={objectType}
                existingConditions={triggerConditions}
                onApply={handleApplyAITrigger}
              />
              <Separator />
            </>
          )}

          {/* Trigger name */}
          <div className="space-y-1.5">
            <Label htmlFor="trigger-name">Name</Label>
            <Input
              id="trigger-name"
              placeholder="e.g. Inbound Web Leads"
              value={triggerName}
              onChange={(e) => setTriggerName(e.target.value)}
            />
          </div>

          {/* Object type */}
          <div className="space-y-1.5">
            <Label htmlFor="trigger-object">Object</Label>
            <Select
              value={objectType}
              onValueChange={(v) => setObjectType(v as ObjectType)}
            >
              <SelectTrigger id="trigger-object" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LEAD">Lead</SelectItem>
                <SelectItem value="CONTACT" disabled={isFreeTier}>
                  Contact {isFreeTier && <span className="ml-1 text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">PRO</span>}
                </SelectItem>
                <SelectItem value="ACCOUNT" disabled={isFreeTier}>
                  Account {isFreeTier && <span className="ml-1 text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">PRO</span>}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trigger event — dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="trigger-event">When to trigger</Label>
            <Select
              value={triggerEvent}
              onValueChange={(v) => setTriggerEvent(v as TriggerEvent)}
            >
              <SelectTrigger id="trigger-event" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INSERT">Record Created</SelectItem>
                <SelectItem value="UPDATE">Record Updated</SelectItem>
                <SelectItem value="BOTH">Any Change</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Trigger Criteria */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Label>Trigger Criteria</Label>
              </div>
              {criteriaCount > 0 && (
                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {criteriaCount} condition{criteriaCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only records matching these conditions will be sent to the routing engine.
              Leave empty to send all records.
            </p>
            <ConditionBuilder
              fields={fields}
              value={triggerConditions}
              onChange={setTriggerConditions}
            />
            {criteriaCount === 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                No criteria defined — all {objectType === "LEAD" ? "Lead" : objectType === "CONTACT" ? "Contact" : "Account"} records will be processed
              </p>
            )}
          </div>

          <Separator />

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
