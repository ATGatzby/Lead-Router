"use client";

const SUGGESTIONS = [
  { icon: "📊", text: "Which routing rule has the highest failure rate this week?" },
  { icon: "⚖️", text: "Is the SDR team workload evenly balanced?" },
  { icon: "💰", text: "Which routing path generates the most pipeline revenue?" },
  { icon: "📈", text: "Show me the routing volume trend for the last 30 days" },
];

interface SuggestionGridProps {
  onSelect: (text: string) => void;
}

export function SuggestionGrid({ onSelect }: SuggestionGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5 max-w-xl w-full">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.text}
          onClick={() => onSelect(s.text)}
          className="rounded-xl border bg-card p-3 text-left text-sm leading-snug transition hover:border-violet-400 hover:bg-violet-50"
        >
          <span className="mb-1 block text-base">{s.icon}</span>
          {s.text}
        </button>
      ))}
    </div>
  );
}
