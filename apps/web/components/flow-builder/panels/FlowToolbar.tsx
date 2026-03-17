"use client"

import { AlignLeft, Save, Upload, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ObjectType, FlowStatus } from "../types"

interface FlowToolbarProps {
  name: string
  onNameChange: (name: string) => void
  objectType: ObjectType
  status: FlowStatus
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onAutoLayout: () => void
  onSave: () => void
  onPublish: () => void
  onTestRun: () => void
  saving: boolean
  publishing: boolean
  viewMode: "canvas" | "english"
  onViewModeChange: (mode: "canvas" | "english") => void
}

export function FlowToolbar({
  name, onNameChange, objectType, status,
  onSave, onPublish, onTestRun, saving, publishing,
  viewMode, onViewModeChange,
}: FlowToolbarProps) {
  return (
    <div className="h-14 bg-white border-b border-zinc-200 flex items-center justify-between px-5">
      {/* Left: flow name */}
      <div className="flex items-center gap-3">
        <input
          value={name}
          onChange={e => onNameChange(e.target.value)}
          className="text-sm font-semibold text-zinc-800 bg-transparent outline-none border-none min-w-[180px] focus:border-b focus:border-violet-400"
        />
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* View toggle */}
        <div className="flex bg-zinc-100 rounded-lg p-0.5">
          <button
            onClick={() => onViewModeChange("canvas")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === "canvas" ? "bg-white text-zinc-800 shadow-sm" : "text-zinc-400"}`}
          >Canvas</button>
          <button
            onClick={() => onViewModeChange("english")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${viewMode === "english" ? "bg-white text-zinc-800 shadow-sm" : "text-zinc-400"}`}
          >
            <AlignLeft className="w-3 h-3" /> English
          </button>
        </div>

        <div className="w-px h-5 bg-zinc-200 mx-1" />

        <Button size="sm" variant="outline" onClick={onTestRun} className="h-8 text-xs">
          <Play className="w-3 h-3 mr-1.5" />Test Run
        </Button>
        <Button size="sm" variant="outline" onClick={onSave} disabled={saving} className="h-8 text-xs">
          <Save className="w-3 h-3 mr-1.5" />{saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" onClick={onPublish} disabled={publishing || saving} className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white">
          <Upload className="w-3 h-3 mr-1.5" />{publishing ? "Publishing..." : "Publish"}
        </Button>
      </div>
    </div>
  )
}
