"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Condition, ConditionGroup as ConditionGroupType, FieldSchema } from "./types";
import { ConditionRow } from "./ConditionRow";
import { nanoid } from "./utils";
import { getOperatorsForType } from "@/lib/operators";

interface Props {
  group: ConditionGroupType;
  groupIndex: number;
  fields: FieldSchema[];
  onUpdate: (updated: ConditionGroupType) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function ConditionGroup({ group, groupIndex, fields, onUpdate, onRemove, canRemove }: Props) {
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const displayName = group.name || `Group ${groupIndex + 1}`;

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const commitName = () => {
    const val = nameInputRef.current?.value.trim() ?? "";
    onUpdate({ ...group, name: val || undefined });
    setIsEditingName(false);
  };
  const addCondition = () => {
    const firstField = fields[0];
    const ops = firstField ? getOperatorsForType(firstField.fieldType) : [];
    const newCond: Condition = {
      id: nanoid(),
      groupId: group.id,
      fieldApiName: firstField?.fieldApiName ?? "",
      fieldType: (firstField?.fieldType ?? "TEXT") as Condition["fieldType"],
      operator: ops[0]?.value ?? "",
      value: "",
    };
    onUpdate({ ...group, conditions: [...group.conditions, newCond] });
  };

  const updateCondition = (condId: string, patch: Partial<Condition>) => {
    onUpdate({
      ...group,
      conditions: group.conditions.map((c) =>
        c.id === condId ? { ...c, ...patch } : c
      ),
    });
  };

  const removeCondition = (condId: string) => {
    onUpdate({
      ...group,
      conditions: group.conditions.filter((c) => c.id !== condId),
    });
  };

  const toggleConjunction = () => {
    onUpdate({ ...group, conjunction: group.conjunction === "AND" ? "OR" : "AND" });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      {/* Group header */}
      <div className="flex items-center justify-between">
        {isEditingName ? (
          <input
            ref={nameInputRef}
            defaultValue={displayName}
            className="text-xs font-medium text-muted-foreground uppercase tracking-wider bg-transparent border-b border-primary outline-none w-32"
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setIsEditingName(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group"
            onClick={() => setIsEditingName(true)}
          >
            {displayName}
            <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
        <div className="flex items-center gap-2">
          {group.conditions.length > 1 && (
            <button
              type="button"
              onClick={toggleConjunction}
              className="rounded border border-border bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              Match {group.conjunction}
            </button>
          )}
          {canRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              aria-label="Remove group"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Condition rows */}
      <div className="space-y-1">
        {group.conditions.map((cond, idx) => (
          <ConditionRow
            key={cond.id}
            condition={cond}
            fields={fields}
            conjunction={group.conjunction}
            showConjunction={idx > 0}
            onUpdate={(patch) => updateCondition(cond.id, patch)}
            onRemove={() => removeCondition(cond.id)}
          />
        ))}
      </div>

      {/* Add condition */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={addCondition}
      >
        <Plus className="h-3 w-3 mr-1" />
        Add condition
      </Button>
    </div>
  );
}
