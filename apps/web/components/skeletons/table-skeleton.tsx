import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Header row */}
      <div className="flex gap-4 px-4 py-3 bg-muted/40 border-b">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 rounded" />
        ))}
      </div>
      {/* Body rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex gap-4 px-4 py-3 border-b last:border-b-0">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className="h-3 flex-1 rounded"
              style={{ maxWidth: colIdx === 0 ? '40%' : `${60 + (colIdx * 10)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
