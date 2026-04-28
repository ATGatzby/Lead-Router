import crypto from "node:crypto";
import { prisma } from "@lead-routing/db";

/**
 * Resolve an `Authorization: Bearer lr_<token>` header into the orgId that
 * issued the token.
 *
 * Used by route handlers under PUBLIC_PREFIXES (e.g. /api/setup/*,
 * /api/fields/sync) where the proxy short-circuits BEFORE the Bearer-token
 * resolution branch. Those handlers must accept either the Apex callout
 * pattern (X-Sfdc-Org-Id) OR a Bearer API token used by the CLI / MCP.
 *
 * Returns null when:
 *   - no Authorization header is present
 *   - the header is malformed
 *   - the token is unknown, revoked, or expired
 *
 * Side effect: bumps `lastUsedAt` for the matched token (fire-and-forget).
 */
export async function resolveBearerOrgId(
  authHeader: string | null | undefined
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith("Bearer lr_")) return null;

  const rawToken = authHeader.slice(7); // "lr_..."
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      orgId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!apiToken) return null;
  if (apiToken.revokedAt) return null;
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) return null;

  // Fire-and-forget lastUsedAt bump — never block request resolution on this.
  prisma.apiToken
    .update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return apiToken.orgId;
}
