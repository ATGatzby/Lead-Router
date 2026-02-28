export type PlanType = "FREE" | "PAID";

export interface PlanLimits {
  seats: number;
  routingLeadsPerMonth: number;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  FREE: {
    seats: 5,
    routingLeadsPerMonth: 100,
  },
  PAID: {
    seats: 20,
    routingLeadsPerMonth: 1000,
  },
};

export function getPlanLimits(plan: PlanType): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** Returns the first day of next month at 00:00:00 UTC */
export function startOfNextMonth(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next;
}
