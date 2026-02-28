"use client";

import type { FieldSchema } from "./types";
import { NO_VALUE_OPERATORS } from "@/lib/operators";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  field: FieldSchema | undefined;
  operator: string;
  value: string;
  onChange: (value: string) => void;
}

export function ValueInput({ field, operator, value, onChange }: Props) {
  // Operators that don't require a value
  if (NO_VALUE_OPERATORS.has(operator)) {
    return null;
  }

  if (!field) {
    return (
      <Input
        className="h-8 text-xs w-[160px]"
        placeholder="Value…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const { fieldType, picklistValues } = field;

  // Picklist / multi-picklist: show a dropdown of options
  if ((fieldType === "PICKLIST" || fieldType === "MULTI_PICKLIST") && picklistValues) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[160px] text-xs h-8">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {picklistValues.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Number
  if (fieldType === "NUMBER") {
    return (
      <Input
        type="number"
        className="h-8 text-xs w-[120px]"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // Date / DateTime
  if (fieldType === "DATE") {
    if (operator === "within_last") {
      return (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            className="h-8 text-xs w-[70px]"
            placeholder="N"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
      );
    }
    return (
      <Input
        type="date"
        className="h-8 text-xs w-[150px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (fieldType === "DATETIME") {
    if (operator === "within_last") {
      return (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            className="h-8 text-xs w-[70px]"
            placeholder="N"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
      );
    }
    return (
      <Input
        type="datetime-local"
        className="h-8 text-xs w-[200px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // Default: text input
  return (
    <Input
      className="h-8 text-xs w-[160px]"
      placeholder="Value…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
