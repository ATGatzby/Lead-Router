import { Suspense } from "react";
import { AnalyticsShell } from "./analytics-shell";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="space-y-4"><div className="h-8 w-48 animate-pulse rounded bg-muted" /></div>}>
      <AnalyticsShell>{children}</AnalyticsShell>
    </Suspense>
  );
}
