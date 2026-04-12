"use client"

import { useState, useEffect } from "react"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Filter, ChevronDown, AlertTriangle } from "lucide-react"
import { ConditionBuilder } from "@/components/condition-builder"
import type { ConditionGroup, FieldSchema } from "@/components/condition-builder/types"
import type { SearchTriggerConfig, ObjectType, ScheduleFrequency } from "../types"
import { objectTypeLabel } from "../types"
import { useCrmType } from "@/lib/hooks/use-crm-type"
import { getObjectTypeLabel } from "@/lib/crm-helpers"

interface FieldsResponse {
  fields: FieldSchema[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  searchTrigger: SearchTriggerConfig
  onSave: (config: SearchTriggerConfig) => void
}

const TIMEZONES = [
  "UTC",
  "US/Eastern",
  "US/Central",
  "US/Mountain",
  "US/Pacific",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
]

const BATCH_SIZES = [200, 500, 1000, 5000, 10000]

export function SearchTriggerConfigSheet({ open, onOpenChange, searchTrigger, onSave }: Props) {
  const [triggerName, setTriggerName] = useState(searchTrigger.triggerName)
  const [objectType, setObjectType] = useState<ObjectType>(searchTrigger.objectType)
  const [searchCriteria, setSearchCriteria] = useState<ConditionGroup[]>(searchTrigger.searchCriteria)
  const [frequency, setFrequency] = useState<ScheduleFrequency | null>(searchTrigger.frequency)
  const [scheduleTime, setScheduleTime] = useState(searchTrigger.scheduleTime)
  const [scheduleTimezone, setScheduleTimezone] = useState(searchTrigger.scheduleTimezone)
  const [batchSize, setBatchSize] = useState(searchTrigger.batchSize)
  const [searchMaxRecords, setSearchMaxRecords] = useState<number | null>(searchTrigger.searchMaxRecords)
  const [skipRecentlyRouted, setSkipRecentlyRouted] = useState(searchTrigger.skipRecentlyRouted)
  const [isDryRun, setIsDryRun] = useState(searchTrigger.isDryRun)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const { crmLabel, objectTypes } = useCrmType()

  // If current objectType isn't valid for this CRM, reset to first available
  useEffect(() => {
    if (objectTypes.length > 0 && !objectTypes.includes(objectType)) {
      setObjectType(objectTypes[0] as ObjectType)
    }
  }, [objectTypes, objectType])

  // Fetch fields for ConditionBuilder
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
    if (isOpen) {
      setTriggerName(searchTrigger.triggerName)
      setObjectType(searchTrigger.objectType)
      setSearchCriteria(searchTrigger.searchCriteria)
      setFrequency(searchTrigger.frequency)
      setScheduleTime(searchTrigger.scheduleTime)
      setScheduleTimezone(searchTrigger.scheduleTimezone)
      setBatchSize(searchTrigger.batchSize)
      setSearchMaxRecords(searchTrigger.searchMaxRecords)
      setSkipRecentlyRouted(searchTrigger.skipRecentlyRouted)
      setIsDryRun(searchTrigger.isDryRun)
    }
    onOpenChange(isOpen)
  }

  const handleSave = () => {
    onSave({
      triggerName,
      objectType,
      searchCriteria,
      frequency,
      scheduleTime,
      scheduleTimezone,
      batchSize,
      searchMaxRecords,
      skipRecentlyRouted,
      isDryRun,
    })
    onOpenChange(false)
  }

  const criteriaCount = (searchCriteria ?? []).flatMap((g) => (g.conditions ?? [])).length

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{`Search ${crmLabel} Trigger`}</SheetTitle>
          <SheetDescription>
            {`Query ${crmLabel} for records matching criteria and route them on a schedule.`}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          {/* Trigger name */}
          <div className="space-y-1.5">
            <Label htmlFor="search-trigger-name">Name</Label>
            <Input
              id="search-trigger-name"
              placeholder="e.g. Hot Lead Search"
              value={triggerName}
              onChange={(e) => setTriggerName(e.target.value)}
            />
          </div>

          {/* Object type */}
          <div className="space-y-1.5">
            <Label htmlFor="search-object">Object</Label>
            <Select
              value={objectType}
              onValueChange={(v) => setObjectType(v as ObjectType)}
            >
              <SelectTrigger id="search-object" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {objectTypes.map((ot) => (
                    <SelectItem key={ot} value={ot}>
                      {getObjectTypeLabel(ot)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Search Criteria */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Label>Search Criteria</Label>
              </div>
              {criteriaCount > 0 && (
                <span className="text-xs font-medium text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">
                  {criteriaCount} condition{criteriaCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {`Records matching ALL of these conditions will be queried from ${crmLabel}.`}
              Leave empty to query all records (up to 50,000).
            </p>
            {fieldsQuery.isLoading && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Loading fields...
              </div>
            )}
            {fieldsQuery.isSuccess && fields.length === 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 mb-3">
                No fields synced yet. Go to Integrations and use &quot;Sync Fields&quot; to import fields from your CRM.
              </div>
            )}
            <ConditionBuilder
              fields={fields}
              value={searchCriteria}
              onChange={setSearchCriteria}
            />
            {criteriaCount === 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                No criteria — all {objectTypeLabel(objectType)} records will be searched
              </p>
            )}
          </div>

          <Separator />

          {/* Frequency */}
          <div className="space-y-3">
            <Label>Frequency</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFrequency("DAILY")}
                className={[
                  "rounded-lg border p-3 text-left transition-colors",
                  frequency !== null
                    ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500"
                    : "border-border hover:border-muted-foreground",
                ].join(" ")}
              >
                <p className="text-sm font-medium">Schedule</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Run on a recurring schedule</p>
              </button>
              <button
                type="button"
                onClick={() => setFrequency(null)}
                className={[
                  "rounded-lg border p-3 text-left transition-colors",
                  frequency === null
                    ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500"
                    : "border-border hover:border-muted-foreground",
                ].join(" ")}
              >
                <p className="text-sm font-medium">One-time</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Manual execution only</p>
              </button>
            </div>

            {/* Schedule options */}
            {frequency !== null && (
              <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/30">
                <div className="space-y-1.5">
                  <Label htmlFor="schedule-repeat">Repeat</Label>
                  <Select
                    value={frequency}
                    onValueChange={(v) => setFrequency(v as ScheduleFrequency)}
                  >
                    <SelectTrigger id="schedule-repeat" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">Daily</SelectItem>
                      <SelectItem value="WEEKLY">Weekly</SelectItem>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule-time">Run at</Label>
                    <Input
                      id="schedule-time"
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule-tz">Timezone</Label>
                    <Select
                      value={scheduleTimezone}
                      onValueChange={setScheduleTimezone}
                    >
                      <SelectTrigger id="schedule-tz" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* One-time disclaimer */}
            {frequency === null && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800">Manual execution required</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    This route will not run automatically. Use the Run button on the routes list page to execute it manually.
                  </p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Advanced section */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-0" : "-rotate-90"}`} />
                Advanced
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              {/* Max records per run */}
              <div className="space-y-1.5">
                <Label htmlFor="max-records">Max records per run</Label>
                <Input
                  id="max-records"
                  type="number"
                  min={1}
                  placeholder="No limit"
                  value={searchMaxRecords ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchMaxRecords(val === "" ? null : Math.max(1, parseInt(val, 10) || 1));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Limit how many records are processed per scheduled run. Leave empty for no limit.
                </p>
              </div>

              {/* Processing batch size */}
              <div className="space-y-1.5">
                <Label htmlFor="batch-size">Processing batch size</Label>
                <Select
                  value={String(batchSize)}
                  onValueChange={(v) => setBatchSize(Number(v))}
                >
                  <SelectTrigger id="batch-size" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BATCH_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size.toLocaleString()} records per batch{size >= 10000 ? " (recommended for large datasets)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Records are processed in batches. Larger batches are faster but use more memory.
                </p>
              </div>

              {/* Skip recently routed */}
              <div className="rounded-lg border border-border p-4 space-y-1">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="skip-recent"
                    checked={skipRecentlyRouted}
                    onCheckedChange={(checked) => setSkipRecentlyRouted(!!checked)}
                  />
                  <Label htmlFor="skip-recent" className="cursor-pointer font-medium">
                    Skip recently routed records
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground ml-7">
                  Skip records that were routed in the last 24 hours to avoid duplicates.
                </p>
              </div>

              {/* Dry run */}
              <div className="rounded-lg border border-border p-4 space-y-1">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="search-dry-run"
                    checked={isDryRun}
                    onCheckedChange={(checked) => setIsDryRun(!!checked)}
                  />
                  <Label htmlFor="search-dry-run" className="cursor-pointer font-medium">
                    Dry run mode
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground ml-7">
                  {`Evaluate and log results without making assignments in ${crmLabel}.`}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
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
