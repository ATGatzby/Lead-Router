import { requireSession } from "@/lib/session";
import { prisma } from "@lead-routing/db";
import { ChatWindow } from "@/components/ai-chat/ChatWindow";

export default async function AiAssistantPage() {
  const session = await requireSession();
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.orgId },
    select: {
      plan: true,
      aiProvider: true,
      aiApiKey: true,
      aiModelName: true,
    },
  });

  return (
    <ChatWindow
      plan={org.plan}
      hasAiKey={!!org.aiApiKey}
      aiProvider={org.aiProvider}
      aiModelName={org.aiModelName}
    />
  );
}
