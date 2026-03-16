"use client";

import { useState, useRef, useEffect } from "react";
import type { FieldSchema } from "./types";
import { NO_VALUE_OPERATORS } from "@/lib/operators";
import { Input } from "@/components/ui/input";
import { Check } from "lucide-react";
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
        className="h-8 text-xs min-w-0 flex-1"
        placeholder="Value…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const { fieldType, picklistValues } = field;

  // Picklist / multi-picklist with multi-select for includes/excludes
  const isMultiOperator = operator === "includes" || operator === "excludes";
  if ((fieldType === "PICKLIST" || fieldType === "MULTI_PICKLIST") && picklistValues) {
    if (isMultiOperator) {
      return (
        <MultiPicklistSelect
          picklistValues={picklistValues}
          value={value}
          onChange={onChange}
        />
      );
    }
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="min-w-0 flex-1 text-xs h-8">
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
        className="h-8 text-xs min-w-0 flex-1"
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
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <Input
            type="number"
            className="h-8 text-xs min-w-0 flex-1"
            placeholder="N"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-xs text-muted-foreground shrink-0">days</span>
        </div>
      );
    }
    return (
      <Input
        type="date"
        className="h-8 text-xs min-w-0 flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (fieldType === "DATETIME") {
    if (operator === "within_last") {
      return (
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <Input
            type="number"
            className="h-8 text-xs min-w-0 flex-1"
            placeholder="N"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-xs text-muted-foreground shrink-0">days</span>
        </div>
      );
    }
    return (
      <Input
        type="datetime-local"
        className="h-8 text-xs min-w-0 flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // Default: text input
  return (
    <Input
      className="h-8 text-xs min-w-0 flex-1"
      placeholder="Value…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── Multi-select picklist dropdown ──────────────────────────────────────────

function MultiPicklistSelect({
  picklistValues,
  value,
  onChange,
}: {
  picklistValues: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];

  const toggle = (item: string) => {
    const next = selected.includes(item)
      ? selected.filter((v) => v !== item)
      : [...selected, item];
    onChange(next.join(","));
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const label =
    selected.length === 0
      ? "Choose…"
      : selected.length <= 2
        ? selected.join(", ")
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-xs ring-offset-background hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <span className={`truncate ${selected.length === 0 ? "text-muted-foreground" : ""}`}>
          {label}
        </span>
        <svg className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[160px] rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95 max-h-48 overflow-y-auto">
          {picklistValues.map((v) => {
            const isSelected = selected.includes(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => toggle(v)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
              >
                <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                  {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </div>
                {v}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
