import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse client across hot-reloads in development
export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export * from "@prisma/client";
export { PLAN_LIMITS, getPlanLimits, startOfNextMonth } from "./plan-limits.js";
export type { PlanType, PlanLimits } from "./plan-limits.js";
export { RULES_INVALIDATE_CHANNEL } from "./constants.js";
