export type CrmType = "SALESFORCE" | "HUBSPOT";

export function getObjectTypesForCrm(crmType: CrmType | null | undefined): string[] {
  if (crmType === "HUBSPOT") return ["CONTACT", "COMPANY", "DEAL"];
  return ["LEAD", "CONTACT", "ACCOUNT"]; // default to SFDC
}

export function getObjectTypeLabel(objectType: string): string {
  const labels: Record<string, string> = {
    LEAD: "Lead",
    CONTACT: "Contact",
    ACCOUNT: "Account",
    COMPANY: "Company",
    DEAL: "Deal",
    USER: "User",
  };
  return labels[objectType] ?? objectType;
}

export function supportsQueues(crmType: CrmType | null | undefined): boolean {
  return crmType !== "HUBSPOT";
}

export function supportsMerge(crmType: CrmType | null | undefined): boolean {
  return crmType !== "HUBSPOT";
}

export function getCrmLabel(crmType: CrmType | null | undefined): string {
  return crmType === "HUBSPOT" ? "HubSpot" : "Salesforce";
}
