"use client";

import { Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface ConfirmationSpec {
  action: string;
  summary: string;
  details?: string[];
  warning?: string;
}

export function parseConfirmationSpec(raw: string): ConfirmationSpec | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.action !== "string" ||
      typeof parsed.summary !== "string"
    ) {
      return null;
    }
    return parsed as ConfirmationSpec;
  } catch {
    return null;
  }
}

interface ConfirmationCardProps {
  spec: ConfirmationSpec;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  resolved?: "confirmed" | "cancelled";
}

export function ConfirmationCard({
  spec,
  onConfirm,
  onCancel,
  disabled,
  resolved,
}: ConfirmationCardProps) {
  const isLocked = !!resolved || !!disabled;

  return (
    <div className="my-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{spec.summary}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Action: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{spec.action}</code>
          </p>
        </div>
        {resolved && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
              resolved === "confirmed"
                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {resolved === "confirmed" ? (
              <>
                <Check className="h-3 w-3" />
                Confirmed
              </>
            ) : (
              <>
                <X className="h-3 w-3" />
                Cancelled
              </>
            )}
          </span>
        )}
      </div>

      {/* Detail items */}
      {spec.details && spec.details.length > 0 && (
        <ul className="mt-3 space-y-1">
          {spec.details.map((detail, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500 dark:bg-violet-400" />
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Warning */}
      {spec.warning && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            {spec.warning}
          </p>
        </div>
      )}

      {/* Buttons */}
      {!resolved && (
        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isLocked}
            className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={isLocked}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
