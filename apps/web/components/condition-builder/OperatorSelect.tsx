"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getOperatorsForType } from "@/lib/operators";

interface Props {
  fieldType: string;
  value: string;
  onChange: (operator: string) => void;
}

export function OperatorSelect({ fieldType, value, onChange }: Props) {
  const operators = getOperatorsForType(fieldType);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="min-w-0 flex-[2] text-xs h-8">
        <SelectValue placeholder="Operator…" />
      </SelectTrigger>
      <SelectContent>
        {operators.map((op) => (
          <SelectItem key={op.value} value={op.value}>
            <span className="flex items-center gap-1.5">
              {op.label}
              {op.value === "similar_to" && (
                <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900 px-1 py-0.5 rounded">
                  AI
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
