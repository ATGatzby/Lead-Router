"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Condition, FieldSchema } from "./types";
import { FieldSelect } from "./FieldSelect";
import { OperatorSelect } from "./OperatorSelect";
import { ValueInput } from "./ValueInput";
import { getOperatorsForType } from "@/lib/operators";

interface Props {
  condition: Condition;
  fields: FieldSchema[];
  conjunction: "AND" | "OR";
  showConjunction: boolean; // false for the first row in a group
  onUpdate: (updated: Partial<Condition>) => void;
  onRemove: () => void;
}

export function ConditionRow({
  condition,
  fields,
  conjunction,
  showConjunction,
  onUpdate,
  onRemove,
}: Props) {
  const field = fields.find((f) => f.fieldApiName === condition.fieldApiName);

  const handleFieldChange = (fieldApiName: string, fieldType: string) => {
    // Reset operator + value when field changes
    const ops = getOperatorsForType(fieldType);
    onUpdate({
      fieldApiName,
      fieldType: fieldType as Condition["fieldType"],
      operator: ops[0]?.value ?? "",
      value: "",
    });
  };

  const handleOperatorChange = (operator: string) => {
    onUpdate({ operator, value: "" });
  };

  return (
    <div className="flex flex-col gap-1">
      {/* AND / OR label between rows */}
      {showConjunction && (
        <div className="px-1 py-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {conjunction}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <FieldSelect
          fields={fields}
          value={condition.fieldApiName}
          onChange={handleFieldChange}
        />
        {condition.fieldApiName && (
          <OperatorSelect
            fieldType={condition.fieldType}
            value={condition.operator}
            onChange={handleOperatorChange}
          />
        )}
        {condition.fieldApiName && condition.operator && (
          <ValueInput
            field={field}
            operator={condition.operator}
            value={condition.value}
            onChange={(value) => onUpdate({ value })}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove condition"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
