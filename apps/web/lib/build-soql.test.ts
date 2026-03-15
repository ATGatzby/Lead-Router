import { describe, it, expect } from "vitest";
import { buildSoqlFromCriteria, SearchCriterion } from "./build-soql";

describe("buildSoqlFromCriteria", () => {
  it("builds basic equals query", () => {
    const criteria: SearchCriterion[] = [
      { field: "Status", operator: "equals", value: "Open" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Status = 'Open' LIMIT 2000"
    );
  });

  it("joins multiple criteria with AND", () => {
    const criteria: SearchCriterion[] = [
      { field: "Status", operator: "equals", value: "Open" },
      { field: "LeadSource", operator: "equals", value: "Web" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Status = 'Open' AND LeadSource = 'Web' LIMIT 2000"
    );
  });

  it("handles contains operator with LIKE", () => {
    const criteria: SearchCriterion[] = [
      { field: "Company", operator: "contains", value: "Acme" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Company LIKE '%Acme%' LIMIT 2000"
    );
  });

  it("handles starts_with operator", () => {
    const criteria: SearchCriterion[] = [
      { field: "Name", operator: "starts_with", value: "John" },
    ];
    const soql = buildSoqlFromCriteria("Contact", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Contact WHERE Name LIKE 'John%' LIMIT 2000"
    );
  });

  it("does not quote numeric values for greater_than", () => {
    const criteria: SearchCriterion[] = [
      { field: "AnnualRevenue", operator: "greater_than", value: "1000000" },
    ];
    const soql = buildSoqlFromCriteria("Account", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name FROM Account WHERE AnnualRevenue > 1000000 LIMIT 2000"
    );
  });

  it("does not quote numeric values for less_than", () => {
    const criteria: SearchCriterion[] = [
      { field: "NumberOfEmployees", operator: "less_than", value: "50" },
    ];
    const soql = buildSoqlFromCriteria("Account", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name FROM Account WHERE NumberOfEmployees < 50 LIMIT 2000"
    );
  });

  it("does not quote SOQL date literals", () => {
    const criteria: SearchCriterion[] = [
      { field: "CreatedDate", operator: "greater_than", value: "LAST_N_DAYS:7" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE CreatedDate > LAST_N_DAYS:7 LIMIT 2000"
    );
  });

  it("does not quote TODAY date literal", () => {
    const criteria: SearchCriterion[] = [
      { field: "CreatedDate", operator: "equals", value: "TODAY" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE CreatedDate = TODAY LIMIT 2000"
    );
  });

  it("returns no WHERE clause for empty criteria", () => {
    const soql = buildSoqlFromCriteria("Lead", []);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead LIMIT 2000"
    );
  });

  it("escapes single quotes to prevent SOQL injection", () => {
    const criteria: SearchCriterion[] = [
      { field: "Company", operator: "equals", value: "O'Reilly" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Company = 'O\\'Reilly' LIMIT 2000"
    );
  });

  it("escapes single quotes in contains operator", () => {
    const criteria: SearchCriterion[] = [
      { field: "Description", operator: "contains", value: "it's" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Description LIKE '%it\\'s%' LIMIT 2000"
    );
  });

  it("handles IN operator with comma-separated values", () => {
    const criteria: SearchCriterion[] = [
      { field: "Status", operator: "in", value: "Open,Closed,Pending" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Status IN ('Open','Closed','Pending') LIMIT 2000"
    );
  });

  it("handles NOT IN operator", () => {
    const criteria: SearchCriterion[] = [
      { field: "Industry", operator: "not_in", value: "Tech, Finance" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Industry NOT IN ('Tech','Finance') LIMIT 2000"
    );
  });

  it("handles is_blank and is_not_blank", () => {
    const criteria: SearchCriterion[] = [
      { field: "Email", operator: "is_blank", value: "" },
      { field: "Phone", operator: "is_not_blank", value: "" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Email = null AND Phone != null LIMIT 2000"
    );
  });

  it("uses Account default fields (no Email)", () => {
    const soql = buildSoqlFromCriteria("Account", []);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name FROM Account LIMIT 2000"
    );
  });

  it("uses custom fields when provided", () => {
    const criteria: SearchCriterion[] = [
      { field: "Status", operator: "equals", value: "Active" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria, ["Id", "Name", "Status", "Company"]);
    expect(soql).toBe(
      "SELECT Id, Name, Status, Company FROM Lead WHERE Status = 'Active' LIMIT 2000"
    );
  });

  it("handles within_last operator for date fields", () => {
    const criteria: SearchCriterion[] = [
      { field: "CreatedDate", operator: "within_last", value: "30" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE CreatedDate >= LAST_N_DAYS:30 LIMIT 2000"
    );
  });

  it("skips criteria with empty field or operator", () => {
    const criteria: SearchCriterion[] = [
      { field: "", operator: "equals", value: "test" },
      { field: "Status", operator: "", value: "Open" },
      { field: "Status", operator: "equals", value: "Active" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Status = 'Active' LIMIT 2000"
    );
  });

  it("skips criteria with empty value for value-requiring operators", () => {
    const criteria: SearchCriterion[] = [
      { field: "AnnualRevenue", operator: "gt", value: "" },
      { field: "Status", operator: "equals", value: "" },
      { field: "Industry", operator: "equals", value: "Tech" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Industry = 'Tech' LIMIT 2000"
    );
  });

  it("keeps is_blank/is_not_blank even with empty value", () => {
    const criteria: SearchCriterion[] = [
      { field: "AnnualRevenue", operator: "gt", value: "" },
      { field: "Email", operator: "is_blank", value: "" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE Email = null LIMIT 2000"
    );
  });

  it("keeps is_true/is_false even with empty value", () => {
    const criteria: SearchCriterion[] = [
      { field: "IsConverted", operator: "is_true", value: "" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead WHERE IsConverted = true LIMIT 2000"
    );
  });

  it("returns no WHERE when all criteria have empty values", () => {
    const criteria: SearchCriterion[] = [
      { field: "AnnualRevenue", operator: "gt", value: "" },
      { field: "Status", operator: "contains", value: "" },
    ];
    const soql = buildSoqlFromCriteria("Lead", criteria);
    expect(soql).toBe(
      "SELECT Id, OwnerId, Name, Email FROM Lead LIMIT 2000"
    );
  });
});
