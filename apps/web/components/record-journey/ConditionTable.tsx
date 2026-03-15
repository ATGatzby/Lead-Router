"use client";

import { cn } from "@/lib/utils";

interface ConditionGroup {
  groupId: string;
  groupMatched: boolean;
  conditions: Array<{
    fieldName: string;
    operator: string;
    expectedValue: string | null;
    actualValue: string | null;
    passed: boolean;
  }>;
}

const OP_LABELS: Record<string, string> = {
  equals: "equals",
  not_equals: "not equals",
  contains: "contains",
  not_contains: "not contains",
  starts_with: "starts with",
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
  before: "before",
  after: "after",
  within_last: "within last (days)",
  is_blank: "is blank",
  is_not_blank: "is not blank",
  is_true: "is true",
  is_false: "is false",
  includes: "includes",
  excludes: "excludes",
  fuzzy_equals: "fuzzy equals",
  sounds_like: "sounds like",
  similar_to: "similar to",
};

export function ConditionTable({ group }: { group: ConditionGroup }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left py-1 pr-3 font-medium">Field</th>
            <th className="text-left py-1 pr-3 font-medium">Operator</th>
            <th className="text-left py-1 pr-3 font-medium">Expected</th>
            <th className="text-left py-1 pr-3 font-medium">Actual</th>
            <th className="text-center py-1 font-medium w-8">Result</th>
          </tr>
        </thead>
        <tbody>
          {group.conditions.map((cond, i) => (
            <tr
              key={i}
              className={cn(
                "border-b last:border-0",
                cond.passed
                  ? "bg-green-50/50 dark:bg-green-950/20"
                  : "bg-red-50/50 dark:bg-red-950/20"
              )}
            >
              <td className="py-1.5 pr-3 font-mono">{cond.fieldName}</td>
              <td className="py-1.5 pr-3">{OP_LABELS[cond.operator] ?? cond.operator}</td>
              <td className="py-1.5 pr-3 max-w-[200px] truncate" title={cond.expectedValue ?? ""}>
                {cond.expectedValue ?? "—"}
              </td>
              <td className="py-1.5 pr-3 max-w-[200px] truncate" title={cond.actualValue ?? ""}>
                {cond.actualValue ?? "—"}
              </td>
              <td className="py-1.5 text-center">
                {cond.passed ? (
                  <span className="text-green-600 dark:text-green-400">✓</span>
                ) : (
                  <span className="text-red-500 dark:text-red-400">✗</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
