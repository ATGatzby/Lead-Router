import { PromptEditor } from "@/components/ai-chat/PromptEditor";

export default function PromptsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Prompt Engineering</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize how your AI assistant behaves with custom instructions, vocabulary, and templates.
        </p>
      </div>
      <PromptEditor />
    </div>
  );
}
