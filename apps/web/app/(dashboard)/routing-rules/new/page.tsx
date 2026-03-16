"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { RouteBuilder } from "@/components/route-builder/RouteBuilder";
import { builderToApiBody } from "@/lib/builder-to-rule";
import type { RouteBuilderState, ObjectType, RouteType } from "@/components/route-builder/types";
import { getLicenseTier, getTierLimits } from "@/lib/license";

function NewRouteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const objectParam = (searchParams.get("object")?.toUpperCase() ?? "LEAD") as ObjectType;
  const tier = getLicenseTier();
  const limits = getTierLimits(tier);
  const validObject: ObjectType = limits.allowedTriggers.includes(objectParam)
    ? objectParam
    : "LEAD";

  const typeParam = searchParams.get("type")?.toUpperCase() ?? "REALTIME";
  const routeType: RouteType = typeParam === "SCHEDULED" ? "SCHEDULED" : "REALTIME";

  const createMutation = useMutation({
    mutationFn: async (state: RouteBuilderState) => {
      const body = builderToApiBody(state);
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create route");
      return data;
    },
    onSuccess: (data) => {
      // Sync trigger criteria to Salesforce (fire-and-forget)
      if (data.rule?.id) {
        fetch(`/api/rules/${data.rule.id}/sync-criteria`, { method: "POST" }).catch(() => {});
      }
      router.push("/routing-rules");
    },
  });

  const isAI = searchParams.get("ai") === "1";

  const defaultState: Partial<RouteBuilderState> = {
    name: "Untitled Route",
    routeType,
    // When AI mode, start with empty canvas (no trigger) — AI will populate everything
    trigger: isAI
      ? null
      : routeType === "REALTIME"
        ? {
            triggerName: "",
            objectType: validObject,
            triggerEvent: "INSERT",
            isDryRun: false,
            triggerConditions: [],
          }
        : null,
    searchTrigger: isAI
      ? null
      : routeType === "SCHEDULED"
        ? {
            triggerName: "",
            objectType: validObject,
            searchCriteria: [],
            frequency: "DAILY",
            scheduleTime: "06:00",
            scheduleTimezone: "UTC",
            batchSize: 500,
            searchMaxRecords: null,
            skipRecentlyRouted: true,
            isDryRun: false,
          }
        : null,
    matchConfig: null,
    paths: [],
    defaultOwner: null,
  };

  return (
    <RouteBuilder
      initialState={defaultState}
      onSave={async (state) => {
        await createMutation.mutateAsync(state);
      }}
      isSaving={createMutation.isPending}
    />
  );
}

export default function NewRoutePage() {
  return (
    <Suspense>
      <NewRouteContent />
    </Suspense>
  );
}
