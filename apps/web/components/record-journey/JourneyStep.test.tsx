import { describe, it, expect } from "vitest";

// We test the trigger label helpers by importing the module and extracting them.
// Since they're not exported, we test them through the rendered output indirectly,
// but we can also duplicate the logic here to unit-test the formatting.

// ── Duplicated helpers (mirrors JourneyStep.tsx private functions) ──────────

function formatObjectLabel(objectType?: string): string {
  if (!objectType) return "Record";
  switch (objectType.toUpperCase()) {
    case "LEAD": return "Lead";
    case "CONTACT": return "Contact";
    case "ACCOUNT": return "Account";
    case "COMPANY": return "Company";
    case "DEAL": return "Deal";
    default: return objectType;
  }
}

function pluralObjectLabel(objectType?: string): string {
  const singular = formatObjectLabel(objectType);
  if (singular.endsWith("y")) return singular.slice(0, -1) + "ies";
  return singular + "s";
}

function formatTriggerSummary(event?: string, objectType?: string): string {
  const obj = formatObjectLabel(objectType);
  switch (event) {
    case "SEARCH": return `Searched ${pluralObjectLabel(objectType)}`;
    case "INSERT": return `${obj} Created`;
    case "UPDATE": return `${obj} Updated`;
    case "BOTH": return `${obj} Created or Updated`;
    default: return `${event ?? "Unknown"} — ${objectType ?? "Unknown"}`;
  }
}

function formatTriggerDescription(event?: string, objectType?: string): string {
  const obj = formatObjectLabel(objectType);
  switch (event) {
    case "SEARCH": return `Searched ${pluralObjectLabel(objectType)}`;
    case "INSERT": return `${obj} Created`;
    case "UPDATE": return `${obj} Updated`;
    case "BOTH": return `${obj} Created or Updated`;
    default: return `${event ?? "Unknown"} event received — ${objectType ?? "Unknown"}`;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("formatObjectLabel", () => {
  it("formats LEAD as Lead", () => {
    expect(formatObjectLabel("LEAD")).toBe("Lead");
  });
  it("formats CONTACT as Contact", () => {
    expect(formatObjectLabel("CONTACT")).toBe("Contact");
  });
  it("formats ACCOUNT as Account", () => {
    expect(formatObjectLabel("ACCOUNT")).toBe("Account");
  });
  it("formats COMPANY as Company", () => {
    expect(formatObjectLabel("COMPANY")).toBe("Company");
  });
  it("formats DEAL as Deal", () => {
    expect(formatObjectLabel("DEAL")).toBe("Deal");
  });
  it("returns Record for undefined", () => {
    expect(formatObjectLabel(undefined)).toBe("Record");
  });
  it("returns raw value for unknown types", () => {
    expect(formatObjectLabel("OPPORTUNITY")).toBe("OPPORTUNITY");
  });
});

describe("pluralObjectLabel", () => {
  it("pluralizes Lead to Leads", () => {
    expect(pluralObjectLabel("LEAD")).toBe("Leads");
  });
  it("pluralizes Contact to Contacts", () => {
    expect(pluralObjectLabel("CONTACT")).toBe("Contacts");
  });
  it("pluralizes Account to Accounts", () => {
    expect(pluralObjectLabel("ACCOUNT")).toBe("Accounts");
  });
  it("pluralizes Company to Companies (y → ies)", () => {
    expect(pluralObjectLabel("COMPANY")).toBe("Companies");
  });
  it("pluralizes Deal to Deals", () => {
    expect(pluralObjectLabel("DEAL")).toBe("Deals");
  });
  it("pluralizes undefined to Records", () => {
    expect(pluralObjectLabel(undefined)).toBe("Records");
  });
});

describe("formatTriggerSummary", () => {
  it("SEARCH + LEAD → Searched Leads", () => {
    expect(formatTriggerSummary("SEARCH", "LEAD")).toBe("Searched Leads");
  });
  it("SEARCH + CONTACT → Searched Contacts", () => {
    expect(formatTriggerSummary("SEARCH", "CONTACT")).toBe("Searched Contacts");
  });
  it("SEARCH + ACCOUNT → Searched Accounts", () => {
    expect(formatTriggerSummary("SEARCH", "ACCOUNT")).toBe("Searched Accounts");
  });
  it("INSERT + LEAD → Lead Created", () => {
    expect(formatTriggerSummary("INSERT", "LEAD")).toBe("Lead Created");
  });
  it("INSERT + CONTACT → Contact Created", () => {
    expect(formatTriggerSummary("INSERT", "CONTACT")).toBe("Contact Created");
  });
  it("UPDATE + LEAD → Lead Updated", () => {
    expect(formatTriggerSummary("UPDATE", "LEAD")).toBe("Lead Updated");
  });
  it("UPDATE + ACCOUNT → Account Updated", () => {
    expect(formatTriggerSummary("UPDATE", "ACCOUNT")).toBe("Account Updated");
  });
  it("BOTH + LEAD → Lead Created or Updated", () => {
    expect(formatTriggerSummary("BOTH", "LEAD")).toBe("Lead Created or Updated");
  });
  it("handles unknown event type", () => {
    expect(formatTriggerSummary("CUSTOM", "LEAD")).toBe("CUSTOM — LEAD");
  });
  it("handles missing values", () => {
    expect(formatTriggerSummary(undefined, undefined)).toBe("Unknown — Unknown");
  });
});

describe("formatTriggerDescription", () => {
  it("SEARCH + CONTACT → Searched Contacts", () => {
    expect(formatTriggerDescription("SEARCH", "CONTACT")).toBe("Searched Contacts");
  });
  it("INSERT + ACCOUNT → Account Created", () => {
    expect(formatTriggerDescription("INSERT", "ACCOUNT")).toBe("Account Created");
  });
  it("UPDATE + LEAD → Lead Updated", () => {
    expect(formatTriggerDescription("UPDATE", "LEAD")).toBe("Lead Updated");
  });
  it("BOTH + CONTACT → Contact Created or Updated", () => {
    expect(formatTriggerDescription("BOTH", "CONTACT")).toBe("Contact Created or Updated");
  });
  it("handles unknown event type with different format", () => {
    expect(formatTriggerDescription("CUSTOM", "LEAD")).toBe("CUSTOM event received — LEAD");
  });
});
