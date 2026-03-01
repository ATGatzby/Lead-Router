import { type NextRequest } from "next/server";
import { pollCliAuthSession } from "@/lib/cli-auth-store";

// GET /api/cli-auth/poll/:sessionId
// Called by the CLI every 2 s to check whether the browser OAuth flow completed.
// Returns { status: 'pending' | 'ok' | 'expired' } + token fields on success.
// The token entry is consumed (deleted) on the first successful poll.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const entry = pollCliAuthSession(sessionId);

  if (!entry) {
    return Response.json({ status: "expired" }, { status: 410 });
  }

  if (entry.status === "pending") {
    return Response.json({ status: "pending" });
  }

  return Response.json({
    status: "ok",
    accessToken: entry.accessToken,
    instanceUrl: entry.instanceUrl,
  });
}
