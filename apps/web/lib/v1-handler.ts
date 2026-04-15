import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { checkV1RateLimit } from "@/lib/v1-rate-limit";
import { logToolCall, getCategory, exportToLangfuse } from "@lead-routing/agent-api";
import type { AgentContext, AgentResponse, CrmType, EngineGateway } from "@lead-routing/agent-api";

interface V1HandlerOptions {
  actionSlug: string;
  engineGateway?: EngineGateway;
}

/**
 * Build the AgentContext from request headers + DB lookup.
 */
async function buildContext(opts: V1HandlerOptions): Promise<AgentContext> {
  const actor = await getActorFromHeaders();
  const org = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { crmType: true },
  });
  const crmType: CrmType = (org?.crmType as CrmType) || "SALESFORCE";

  return {
    orgId: actor.orgId,
    actorId: actor.userId,
    actorName: actor.userName,
    crmType,
    prisma,
    engineGateway: opts.engineGateway,
  };
}

/**
 * Wrap a POST action handler with rate limiting, context building, and error handling.
 */
export function v1Post<TInput, TOutput>(
  actionSlug: string,
  actionFn: (input: TInput, ctx: AgentContext) => Promise<AgentResponse<TOutput>>,
  opts?: { engineGateway?: EngineGateway },
) {
  return async function POST(req: NextRequest) {
    try {
      const actor = await getActorFromHeaders();

      // Rate limit check
      const rateCheck = await checkV1RateLimit(actor.userId, actionSlug);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "Rate limit exceeded",
              remediation: `Wait ${rateCheck.retryAfterSeconds}s before retrying.`,
            },
          },
          { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } },
        );
      }

      const ctx = await buildContext({ actionSlug, engineGateway: opts?.engineGateway });
      const body = await req.json();
      const result = await actionFn(body, ctx);

      // Log to ToolCallLog (fire-and-forget)
      const responseJson = JSON.stringify(result);
      logToolCall(prisma as any, {
        orgId: ctx.orgId,
        tokenId: ctx.actorId,
        tool: actionSlug,
        category: getCategory(actionSlug),
        status: result.success ? "success" : "error",
        errorCode: result.error?.code,
        durationMs: result._meta?.duration_ms ?? 0,
        input: body,
        responseSize: responseJson.length,
        crmType: ctx.crmType,
        warnings: result.warnings,
      });

      // Export to Langfuse if enabled (awaited — must complete before response)
      await exportToLangfuse({
        tool: actionSlug,
        input: body,
        output: result as any,
        durationMs: result._meta?.duration_ms ?? 0,
        status: result.success ? "success" : "error",
        errorCode: result.error?.code,
        orgId: ctx.orgId,
        tokenId: ctx.actorId,
        crmType: ctx.crmType,
        category: getCategory(actionSlug),
        warnings: result.warnings,
      });

      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    } catch (err) {
      console.error(`POST /api/v1/actions/${actionSlug} error:`, err);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : "Unknown error",
            remediation: "Try again or contact support.",
          },
        },
        { status: 500 },
      );
    }
  };
}

/**
 * Wrap a GET action handler with rate limiting, context building, and error handling.
 * GET actions receive query params as input (converted to a plain object).
 */
export function v1Get<TInput, TOutput>(
  actionSlug: string,
  actionFn: (input: TInput, ctx: AgentContext) => Promise<AgentResponse<TOutput>>,
) {
  return async function GET(req: NextRequest) {
    try {
      const actor = await getActorFromHeaders();

      // Rate limit check
      const rateCheck = await checkV1RateLimit(actor.userId, actionSlug);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "Rate limit exceeded",
              remediation: `Wait ${rateCheck.retryAfterSeconds}s before retrying.`,
            },
          },
          { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } },
        );
      }

      const ctx = await buildContext({ actionSlug });

      // Convert query params to plain object for the action input
      const params: Record<string, string> = {};
      req.nextUrl.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const result = await actionFn(params as unknown as TInput, ctx);

      // Log to ToolCallLog (fire-and-forget)
      const responseJson = JSON.stringify(result);
      logToolCall(prisma as any, {
        orgId: ctx.orgId,
        tokenId: ctx.actorId,
        tool: actionSlug,
        category: getCategory(actionSlug),
        status: result.success ? "success" : "error",
        errorCode: result.error?.code,
        durationMs: result._meta?.duration_ms ?? 0,
        input: params,
        responseSize: responseJson.length,
        crmType: ctx.crmType,
        warnings: result.warnings,
      });

      // Export to Langfuse if enabled (awaited — must complete before response)
      await exportToLangfuse({
        tool: actionSlug,
        input: params,
        output: result as any,
        durationMs: result._meta?.duration_ms ?? 0,
        status: result.success ? "success" : "error",
        errorCode: result.error?.code,
        orgId: ctx.orgId,
        tokenId: ctx.actorId,
        crmType: ctx.crmType,
        category: getCategory(actionSlug),
        warnings: result.warnings,
      });

      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    } catch (err) {
      console.error(`GET /api/v1/actions/${actionSlug} error:`, err);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : "Unknown error",
            remediation: "Try again or contact support.",
          },
        },
        { status: 500 },
      );
    }
  };
}
