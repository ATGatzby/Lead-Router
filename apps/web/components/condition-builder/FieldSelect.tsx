"use client";

import { useState } from "react";
import type { FieldSchema } from "./types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";

interface Props {
  fields: FieldSchema[];
  value: string; // fieldApiName
  onChange: (fieldApiName: string, fieldType: string) => void;
}

// Group fields alphabetically into chunks for the dropdown
const TYPE_LABELS: Record<string, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  DATETIME: "Date/Time",
  BOOLEAN: "Checkbox",
  PICKLIST: "Picklist",
  MULTI_PICKLIST: "Multi-Select Picklist",
  LOOKUP: "Lookup",
};

export function FieldSelect({ fields, value, onChange }: Props) {
  const [search, setSearch] = useState("");

  const filtered = fields.filter(
    (f) =>
      f.fieldLabel.toLowerCase().includes(search.toLowerCase()) ||
      f.fieldApiName.toLowerCase().includes(search.toLowerCase())
  );

  // Group by type
  const grouped = filtered.reduce<Record<string, FieldSchema[]>>((acc, f) => {
    const key = f.fieldType;
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {});

  const groupKeys = Object.keys(grouped).sort();

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const field = fields.find((f) => f.fieldApiName === v);
        if (field) onChange(field.fieldApiName, field.fieldType);
      }}
    >
      <SelectTrigger className="w-[200px] text-xs h-8">
        <SelectValue placeholder="Select field…" />
      </SelectTrigger>
      <SelectContent>
        {/* Simple search input inside the dropdown */}
        <div className="px-2 pb-1.5 pt-1">
          <input
            className="w-full rounded border border-input bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search fields…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        {groupKeys.length === 0 && (
          <div className="py-3 text-center text-xs text-muted-foreground">No fields found</div>
        )}
        {groupKeys.map((type) => (
          <SelectGroup key={type}>
            <SelectLabel>{TYPE_LABELS[type] ?? type}</SelectLabel>
            {grouped[type].map((f) => (
              <SelectItem key={f.fieldApiName} value={f.fieldApiName}>
                {f.fieldLabel}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
