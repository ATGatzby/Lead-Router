export type LicenseTier = "free" | "pro";

export interface TierLimits {
  maxRules: number;
  maxOrgs: number;
  maxSeats: number;
  allowedTriggers: string[];
  weightedDistribution: boolean;
  analytics: boolean;
  auditLog: boolean;
  aiRuleGenerator: boolean;
}

const FREE_LIMITS: TierLimits = {
  maxRules: 2,
  maxOrgs: 1,
  maxSeats: 10,
  allowedTriggers: ["LEAD", "CONTACT", "COMPANY", "DEAL"],
  weightedDistribution: true,
  analytics: true,
  auditLog: true,
  aiRuleGenerator: true,
};

const PRO_LIMITS: TierLimits = {
  maxRules: Infinity,
  maxOrgs: 1,
  maxSeats: Infinity,
  allowedTriggers: ["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"],
  weightedDistribution: true,
  analytics: true,
  auditLog: true,
  aiRuleGenerator: true,
};

// Module-level override — set by /api/license/activate or on startup from DB
let tierOverride: LicenseTier | null = null;

export function getLicenseTier(): LicenseTier {
  if (tierOverride) return tierOverride;
  const tier = process.env.LICENSE_TIER;
  return tier === "pro" ? "pro" : "free";
}

/** Called after license activation to immediately update the in-process tier */
export function setLicenseTierOverride(tier: LicenseTier): void {
  tierOverride = tier;
  process.env.LICENSE_TIER = tier;
}

export function getTierLimits(tier?: LicenseTier): TierLimits {
  const t = tier ?? getLicenseTier();
  return t === "pro" ? PRO_LIMITS : FREE_LIMITS;
}

/** Helper for API routes — returns a 402 response with upgrade message */
export function upgradeRequiredResponse(feature: string) {
  return Response.json(
    {
      error: "upgrade_required",
      message: `${feature} requires a Pro license. Upgrade at https://openedgeai.tech/pricing`,
      tier: "free",
    },
    { status: 402 },
  );
}
