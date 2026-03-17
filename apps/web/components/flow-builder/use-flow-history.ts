import { useState, useCallback, useRef } from "react"
import type { FlowNodeData, FlowEdgeData } from "./types"

interface HistoryEntry {
  nodes: FlowNodeData[]
  edges: FlowEdgeData[]
}

const MAX_HISTORY = 50

export function useFlowHistory(initialNodes: FlowNodeData[], initialEdges: FlowEdgeData[]) {
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])
  const currentRef = useRef<HistoryEntry>({ nodes: initialNodes, edges: initialEdges })

  const pushHistory = useCallback((nodes: FlowNodeData[], edges: FlowEdgeData[]) => {
    setPast(prev => {
      const next = [...prev, { ...currentRef.current }]
      if (next.length > MAX_HISTORY) next.shift()
      return next
    })
    setFuture([])
    currentRef.current = { nodes, edges }
  }, [])

  const undo = useCallback((): HistoryEntry | null => {
    if (past.length === 0) return null
    const prev = past[past.length - 1]
    setPast(p => p.slice(0, -1))
    setFuture(f => [{ ...currentRef.current }, ...f])
    currentRef.current = prev
    return prev
  }, [past])

  const redo = useCallback((): HistoryEntry | null => {
    if (future.length === 0) return null
    const next = future[0]
    setFuture(f => f.slice(1))
    setPast(p => [...p, { ...currentRef.current }])
    currentRef.current = next
    return next
  }, [future])

  return {
    pushHistory,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
