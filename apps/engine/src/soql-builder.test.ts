import { describe, it, expect } from "vitest";
import { buildSearchSOQL, buildCountSOQL, escapeSoqlField, escapeSoqlValue } from "./soql-builder.js";

describe("soql-builder", () => {
  describe("buildSearchSOQL", () => {
    it("returns SELECT with LIMIT when no criteria", () => {
      const sql = buildSearchSOQL("LEAD", null);
      expect(sql).toMatch(/^SELECT .+ FROM Lead LIMIT 50000$/);
    });

    it("returns SELECT with LIMIT for empty criteria array", () => {
      const sql = buildSearchSOQL("LEAD", []);
      expect(sql).toMatch(/^SELECT .+ FROM Lead LIMIT 50000$/);
    });

    it("builds single condition", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "Status", operator: "equals", value: "Open", fieldType: "PICKLIST" }] },
      ]);
      expect(sql).toContain("WHERE Status = 'Open'");
      expect(sql).toContain("LIMIT 50000");
    });

    it("builds AND within a group", () => {
      const sql = buildSearchSOQL("LEAD", [
        {
          id: "g1",
          conditions: [
            { fieldApiName: "Status", operator: "equals", value: "Open", fieldType: "PICKLIST" },
            { fieldApiName: "Rating", operator: "equals", value: "Hot", fieldType: "PICKLIST" },
          ],
        },
      ]);
      expect(sql).toContain("(Status = 'Open' AND Rating = 'Hot')");
    });

    it("builds OR between groups", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "Status", operator: "equals", value: "Open" }] },
        { id: "g2", conditions: [{ fieldApiName: "Status", operator: "equals", value: "New" }] },
      ]);
      expect(sql).toContain("Status = 'Open' OR Status = 'New'");
    });

    it("handles numeric values without quotes", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "AnnualRevenue", operator: "greater_than", value: "100000", fieldType: "CURRENCY" }] },
      ]);
      expect(sql).toContain("AnnualRevenue > 100000");
      expect(sql).not.toContain("'100000'");
    });

    it("handles date literals without quotes", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "CreatedDate", operator: "greater_than", value: "LAST_N_DAYS:7", fieldType: "DATETIME" }] },
      ]);
      expect(sql).toContain("CreatedDate > LAST_N_DAYS:7");
      expect(sql).not.toContain("'LAST_N_DAYS:7'");
    });

    it("handles LIKE operators", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "Company", operator: "contains", value: "Acme" }] },
      ]);
      expect(sql).toContain("Company LIKE '%Acme%'");
    });

    it("handles starts_with", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "Name", operator: "starts_with", value: "John" }] },
      ]);
      expect(sql).toContain("Name LIKE 'John%'");
    });

    it("handles is_blank / is_not_blank", () => {
      const sql = buildSearchSOQL("LEAD", [
        {
          id: "g1",
          conditions: [
            { fieldApiName: "Email", operator: "is_blank", value: null },
            { fieldApiName: "Phone", operator: "is_not_blank", value: null },
          ],
        },
      ]);
      expect(sql).toContain("Email = null");
      expect(sql).toContain("Phone != null");
    });

    it("handles IN operator", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "Status", operator: "in", value: "Open,New,Contacted" }] },
      ]);
      expect(sql).toContain("Status IN ('Open', 'New', 'Contacted')");
    });

    it("handles boolean operators", () => {
      const sql = buildSearchSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "IsConverted", operator: "is_false", value: null }] },
      ]);
      expect(sql).toContain("IsConverted = false");
    });

    it("uses correct object name for CONTACT", () => {
      const sql = buildSearchSOQL("CONTACT", null);
      expect(sql).toContain("FROM Contact");
    });

    it("uses correct object name for ACCOUNT", () => {
      const sql = buildSearchSOQL("ACCOUNT", null);
      expect(sql).toContain("FROM Account");
    });

    it("respects custom limit", () => {
      const sql = buildSearchSOQL("LEAD", null, 200);
      expect(sql).toContain("LIMIT 200");
    });
  });

  describe("buildCountSOQL", () => {
    it("returns COUNT query without criteria", () => {
      expect(buildCountSOQL("LEAD", null)).toBe("SELECT COUNT() FROM Lead");
    });

    it("returns COUNT query with criteria", () => {
      const sql = buildCountSOQL("LEAD", [
        { id: "g1", conditions: [{ fieldApiName: "Status", operator: "equals", value: "Open" }] },
      ]);
      expect(sql).toBe("SELECT COUNT() FROM Lead WHERE Status = 'Open'");
    });
  });

  describe("escapeSoqlValue", () => {
    it("escapes single quotes", () => {
      expect(escapeSoqlValue("O'Brien")).toBe("O\\'Brien");
    });

    it("escapes backslashes", () => {
      expect(escapeSoqlValue("path\\to")).toBe("path\\\\to");
    });

    it("handles combined escaping", () => {
      expect(escapeSoqlValue("it's a \\test")).toBe("it\\'s a \\\\test");
    });
  });

  describe("escapeSoqlField", () => {
    it("allows valid field names", () => {
      expect(escapeSoqlField("LeadSource")).toBe("LeadSource");
      expect(escapeSoqlField("Custom_Field__c")).toBe("Custom_Field__c");
      expect(escapeSoqlField("Account.Name")).toBe("Account.Name");
    });

    it("strips invalid characters", () => {
      expect(escapeSoqlField("Field; DROP TABLE--")).toBe("FieldDROPTABLE");
    });
  });
});
