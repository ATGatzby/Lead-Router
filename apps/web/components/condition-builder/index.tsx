"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConditionGroup, RuleConditions, FieldSchema, Condition } from "./types";
import { ConditionGroup as ConditionGroupComponent } from "./ConditionGroup";
import { GroupConnector } from "./GroupConnector";
import { nanoid } from "./utils";
import { getOperatorsForType } from "@/lib/operators";

interface Props {
  value: RuleConditions;
  onChange: (groups: RuleConditions) => void;
  fields: FieldSchema[];
}

export function ConditionBuilder({ value: groups, onChange, fields }: Props) {
  const addGroup = () => {
    const firstField = fields[0];
    const ops = firstField ? getOperatorsForType(firstField.fieldType) : [];
    const groupId = nanoid();
    const newGroup: ConditionGroup = {
      id: groupId,
      conjunction: "AND",
      conditions: [
        {
          id: nanoid(),
          groupId,
          fieldApiName: firstField?.fieldApiName ?? "",
          fieldType: (firstField?.fieldType ?? "TEXT") as Condition["fieldType"],
          operator: ops[0]?.value ?? "",
          value: "",
        },
      ],
    };
    onChange([...groups, newGroup]);
  };

  const updateGroup = (groupId: string, updated: ConditionGroup) => {
    onChange(groups.map((g) => (g.id === groupId ? updated : g)));
  };

  const removeGroup = (groupId: string) => {
    onChange(groups.filter((g) => g.id !== groupId));
  };

  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No conditions — this rule will match every record (catch-all).
        </div>
      )}

      {groups.map((group, idx) => (
        <div key={group.id} className="space-y-3">
          {idx > 0 && <GroupConnector />}
          <ConditionGroupComponent
            group={group}
            fields={fields}
            onUpdate={(updated) => updateGroup(group.id, updated)}
            onRemove={() => removeGroup(group.id)}
            canRemove={groups.length > 0}
          />
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={addGroup}
        disabled={fields.length === 0}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add condition group
      </Button>
    </div>
  );
}

// Re-export types for consumers
export type { RuleConditions, ConditionGroup, Condition, FieldSchema } from "./types";
