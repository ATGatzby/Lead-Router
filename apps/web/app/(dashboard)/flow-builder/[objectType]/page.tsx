"use client"

import { use } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { FlowBuilder } from "@/components/flow-builder/FlowBuilder"
import type { FlowNodeData, FlowEdgeData, ObjectType } from "@/components/flow-builder/types"
import type { FieldSchema } from "@/components/condition-builder/types"

interface PageProps {
  params: Promise<{ objectType: string }>
}

export default function FlowBuilderPage({ params }: PageProps) {
  const { objectType } = use(params)
  const ot = objectType.toUpperCase() as ObjectType
  const queryClient = useQueryClient()

  // Fetch flow
  const flowQuery = useQuery({
    queryKey: ["flow", ot],
    queryFn: async () => {
      const res = await fetch(`/api/flows/${ot}`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error("Failed to load flow")
      return res.json()
    },
  })

  // Fetch fields
  const fieldsQuery = useQuery<{ fields: FieldSchema[] }>({
    queryKey: ["fields", ot],
    queryFn: async () => {
      const res = await fetch(`/api/fields?object=${ot}`)
      if (!res.ok) throw new Error("Failed to load fields")
      return res.json()
    },
  })

  // Create flow if doesn't exist
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectType: ot, name: `${ot.charAt(0) + ot.slice(1).toLowerCase()} Routing Flow` }),
      })
      if (!res.ok) throw new Error("Failed to create flow")
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flow", ot] }),
  })

  // Save flow
  const saveMutation = useMutation({
    mutationFn: async (data: { name: string; nodes: FlowNodeData[]; edges: FlowEdgeData[]; triggerEvent: string; isDryRun: boolean }) => {
      const res = await fetch(`/api/flows/${ot}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          triggerEvent: data.triggerEvent,
          isDryRun: data.isDryRun,
          nodes: data.nodes.map(n => ({
            id: n.id,
            type: n.type,
            label: n.label,
            positionX: n.position.x,
            positionY: n.position.y,
            config: n.config,
          })),
          edges: data.edges.map(e => ({
            id: e.id,
            fromId: e.source,
            toId: e.target,
            label: e.label,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
        }),
      })
      if (!res.ok) throw new Error("Failed to save flow")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flow", ot] })
      toast.success("Flow saved")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // Publish
  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/flows/${ot}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      })
      if (!res.ok) throw new Error("Failed to publish flow")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flow", ot] })
      toast.success("Flow published and active")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (flowQuery.isLoading || fieldsQuery.isLoading) {
    return <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-500">Loading flow...</div>
  }

  // Auto-create flow if none exists
  if (!flowQuery.data?.flow) {
    if (!createMutation.isPending) createMutation.mutate()
    return <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-500">Creating flow...</div>
  }

  const flow = flowQuery.data.flow
  const fields = fieldsQuery.data?.fields ?? []

  const initialNodes: FlowNodeData[] = (flow.nodes ?? []).map((n: any) => ({
    id: n.id,
    type: n.type,
    label: n.label ?? n.type,
    position: { x: n.positionX ?? 0, y: n.positionY ?? 0 },
    config: n.config ?? {},
  }))

  const initialEdges: FlowEdgeData[] = (flow.edges ?? []).map((e: any) => ({
    id: e.id,
    source: e.fromId,
    target: e.toId,
    label: e.label ?? undefined,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }))

  return (
    <FlowBuilder
      flowId={flow.id}
      initialName={flow.name}
      initialNodes={initialNodes}
      initialEdges={initialEdges}
      objectType={ot}
      status={flow.status}
      fields={fields}
      onSave={saveMutation.mutateAsync}
      onPublish={publishMutation.mutateAsync}
    />
  )
}
