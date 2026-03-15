import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

/**
 * Validates Bearer token for internal-only endpoints (analytics, etc.).
 * Reads INTERNAL_API_KEY from env — if not set, all requests are allowed (backward compat).
 */
export function validateInternalToken(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (!expectedKey) {
    console.error("[auth] INTERNAL_API_KEY not set — rejecting request");
    reply.code(503).send({ error: "INTERNAL_API_KEY not configured" });
    return;
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing Authorization header" });
    return;
  }

  const token = auth.slice(7);
  if (token !== expectedKey) {
    reply.code(403).send({ error: "Invalid token" });
    return;
  }

  done();
}
