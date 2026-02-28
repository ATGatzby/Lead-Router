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
      <SelectTrigger className="w-[170px] text-xs h-8">
        <SelectValue placeholder="Operator…" />
      </SelectTrigger>
      <SelectContent>
        {operators.map((op) => (
          <SelectItem key={op.value} value={op.value}>
            {op.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
