"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getCrmLabel,
  getObjectTypesForCrm,
  supportsQueues,
  supportsMerge,
  type CrmType,
} from "@/lib/crm-helpers";

interface LicenseResponse {
  crmType: CrmType | null;
  [key: string]: unknown;
}

async function fetchLicense(): Promise<LicenseResponse> {
  const res = await fetch("/api/license");
  if (!res.ok) return { crmType: null };
  return res.json();
}

export function useCrmType() {
  const { data } = useQuery({
    queryKey: ["license"],
    queryFn: fetchLicense,
    staleTime: 60_000,
  });

  const crmType = data?.crmType ?? null;

  return {
    crmType,
    crmLabel: getCrmLabel(crmType),
    isHubSpot: crmType === "HUBSPOT",
    isSalesforce: crmType === "SALESFORCE" || crmType === null,
    supportsQueues: supportsQueues(crmType),
    supportsMerge: supportsMerge(crmType),
    objectTypes: getObjectTypesForCrm(crmType),
  };
}
