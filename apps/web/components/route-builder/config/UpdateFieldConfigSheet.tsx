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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { FieldSchema } from "@/components/condition-builder"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fieldApiName: string
  fieldValue: string
  fields: FieldSchema[]
  onSave: (fieldApiName: string, fieldValue: string) => void
}

export function UpdateFieldConfigSheet({
  open,
  onOpenChange,
  fieldApiName,
  fieldValue,
  fields,
  onSave,
}: Props) {
  const [localFieldApiName, setLocalFieldApiName] = useState(fieldApiName)
  const [localFieldValue, setLocalFieldValue] = useState(fieldValue)

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setLocalFieldApiName(fieldApiName)
      setLocalFieldValue(fieldValue)
    }
    onOpenChange(isOpen)
  }

  const handleSave = () => {
    onSave(localFieldApiName, localFieldValue)
    onOpenChange(false)
  }

  const selectedField = fields.find((f) => f.fieldApiName === localFieldApiName)
  const hasPicklist =
    selectedField?.picklistValues && selectedField.picklistValues.length > 0

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Update Field</SheetTitle>
          <SheetDescription>
            Set a field value on the record before routing continues.
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Field</Label>
              <Select
                value={localFieldApiName}
                onValueChange={(val) => {
                  setLocalFieldApiName(val)
                  setLocalFieldValue("")
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.fieldApiName} value={f.fieldApiName}>
                      {f.fieldLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Value</Label>
              {hasPicklist ? (
                <Select
                  value={localFieldValue}
                  onValueChange={setLocalFieldValue}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select value..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedField!.picklistValues ?? []).map((v: string) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={localFieldValue}
                  onChange={(e) => setLocalFieldValue(e.target.value)}
                  placeholder="Enter value..."
                />
              )}
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
            disabled={!localFieldApiName || !localFieldValue}
          >
            Save Field Update
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
