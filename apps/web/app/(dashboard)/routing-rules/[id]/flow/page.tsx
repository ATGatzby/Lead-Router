"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RouteBuilder } from "@/components/route-builder/RouteBuilder";
import { apiRuleToBuilderState, builderToApiBody } from "@/lib/builder-to-rule";
import type { RouteBuilderState } from "@/components/route-builder/types";

export default function RouteFlowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const ruleQuery = useQuery<{ rule: any }>({
    queryKey: ["rule", id],
    queryFn: async () => {
      const res = await fetch(`/api/rules/${id}`);
      if (!res.ok) throw new Error("Failed to load rule");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (state: RouteBuilderState) => {
      const body = builderToApiBody(state);
      const res = await fetch(`/api/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save route");
      return data;
    },
    onSuccess: (data) => {
      // Update the cache with the fresh response (includes branches)
      queryClient.setQueryData(["rule", id], data);
      // Sync trigger criteria to Salesforce (fire-and-forget)
      fetch(`/api/rules/${id}/sync-criteria`, { method: "POST" }).catch(() => {});
      router.push("/routing-rules");
    },
  });

  if (ruleQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading route…
      </div>
    );
  }

  if (ruleQuery.isError || !ruleQuery.data?.rule) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive text-sm">
        Route not found.
      </div>
    );
  }

  const initialState = apiRuleToBuilderState(ruleQuery.data.rule);

  return (
    <RouteBuilder
      key={ruleQuery.dataUpdatedAt}
      ruleId={id}
      initialState={initialState}
      onSave={async (state) => {
        await saveMutation.mutateAsync(state);
      }}
      isSaving={saveMutation.isPending}
    />
  );
}
