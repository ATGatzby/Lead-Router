"use client";

interface Props {
  label?: string; // defaults to "OR"
}

/** Visual separator between condition groups — always OR between groups */
export function GroupConnector({ label = "OR" }: Props) {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
