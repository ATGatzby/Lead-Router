"use client";

import { BrainCircuit, Check } from "lucide-react";

const FEATURES = [
  "Natural language queries on all routing data",
  "Performance analysis & anomaly detection",
  "Conversion & pipeline insights",
  "Rule optimization recommendations",
  "Bring your own API key (Claude, OpenAI, Gemini, or custom)",
];

export function PaywallOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 dark:bg-gray-950/90 backdrop-blur-sm">
      <div className="max-w-sm text-center px-6">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
          <BrainCircuit className="h-7 w-7 text-violet-600 dark:text-violet-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Unlock AI Routing Assistant</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          Get instant insights from your routing data with natural language queries.
          Analyze performance, detect anomalies, and optimize your lead routing.
        </p>
        <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 dark:from-violet-500 dark:to-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/40">
          <BrainCircuit className="h-4 w-4" />
          Upgrade to Pro
        </button>
        <div className="mt-5 flex flex-col gap-2 text-left">
          {FEATURES.map((f) => (
            <div key={f} className="flex items-center gap-2 text-xs text-foreground">
              <Check className="h-3.5 w-3.5 text-green-500 dark:text-green-400 shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
