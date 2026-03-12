"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { RouteBuilder } from "@/components/route-builder/RouteBuilder";
import { builderToApiBody } from "@/lib/builder-to-rule";
import type { RouteBuilderState, ObjectType } from "@/components/route-builder/types";

function NewRouteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const objectParam = (searchParams.get("object")?.toUpperCase() ?? "LEAD") as ObjectType;
  const validObject: ObjectType = ["LEAD", "CONTACT", "ACCOUNT"].includes(objectParam)
    ? objectParam
    : "LEAD";

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

  const defaultState: Partial<RouteBuilderState> = {
    name: "Untitled Route",
    trigger: {
      triggerName: "",
      objectType: validObject,
      triggerEvent: "INSERT",
      isDryRun: false,
      triggerConditions: [],
    },
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
