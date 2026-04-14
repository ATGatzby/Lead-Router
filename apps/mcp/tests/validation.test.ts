import { describe, it, expect } from "vitest";
import {
  validateInput,
  GetRuleInput,
  CreateRuleInput,
  DeleteRuleInput,
  RouteLeadInput,
  CreateTeamInput,
  AddTeamMemberInput,
  ObjectTypeEnum,
  ListUsersInput,
} from "../src/utils/validate.js";

describe("validateInput", () => {
  describe("GetRuleInput", () => {
    it("passes with valid ruleId", () => {
      const result = validateInput(GetRuleInput, { ruleId: "r1" });
      expect(result.ruleId).toBe("r1");
    });

    it("throws on missing ruleId", () => {
      expect(() => validateInput(GetRuleInput, {})).toThrow("Invalid input");
    });

    it("throws on empty ruleId", () => {
      expect(() => validateInput(GetRuleInput, { ruleId: "" })).toThrow("Invalid input");
    });
  });

  describe("CreateRuleInput", () => {
    it("passes with required fields", () => {
      const result = validateInput(CreateRuleInput, {
        name: "Test",
        objectType: "LEAD",
        triggerEvent: "INSERT",
      });
      expect(result.name).toBe("Test");
      expect(result.objectType).toBe("LEAD");
    });

    it("throws on missing name", () => {
      expect(() =>
        validateInput(CreateRuleInput, { objectType: "LEAD", triggerEvent: "INSERT" })
      ).toThrow("Invalid input");
    });

    it("throws on invalid objectType", () => {
      expect(() =>
        validateInput(CreateRuleInput, { name: "Test", objectType: "INVALID", triggerEvent: "INSERT" })
      ).toThrow("Invalid input");
    });

    it("throws on invalid triggerEvent", () => {
      expect(() =>
        validateInput(CreateRuleInput, { name: "Test", objectType: "LEAD", triggerEvent: "NEVER" })
      ).toThrow("Invalid input");
    });

    it("accepts optional confirm and branches", () => {
      const result = validateInput(CreateRuleInput, {
        name: "Test",
        objectType: "LEAD",
        triggerEvent: "INSERT",
        confirm: true,
        branches: [{ assignmentType: "USER" }],
      });
      expect(result.confirm).toBe(true);
      expect(result.branches).toHaveLength(1);
    });
  });

  describe("DeleteRuleInput", () => {
    it("passes with ruleId", () => {
      const result = validateInput(DeleteRuleInput, { ruleId: "r1" });
      expect(result.ruleId).toBe("r1");
    });

    it("rejects unknown fields (strict)", () => {
      expect(() =>
        validateInput(DeleteRuleInput, { ruleId: "r1", extra: true })
      ).toThrow("Invalid input");
    });
  });

  describe("RouteLeadInput", () => {
    it("passes with all required fields", () => {
      const result = validateInput(RouteLeadInput, {
        objectType: "LEAD",
        eventType: "INSERT",
        recordId: "00Q001",
        fields: { Email: "test@test.com" },
      });
      expect(result.recordId).toBe("00Q001");
    });

    it("throws on missing fields", () => {
      expect(() =>
        validateInput(RouteLeadInput, { objectType: "LEAD", eventType: "INSERT", recordId: "00Q001" })
      ).toThrow("Invalid input");
    });
  });

  describe("CreateTeamInput", () => {
    it("passes with name only", () => {
      const result = validateInput(CreateTeamInput, { name: "Sales" });
      expect(result.name).toBe("Sales");
    });

    it("accepts valid distributionType", () => {
      const result = validateInput(CreateTeamInput, { name: "Sales", distributionType: "weighted" });
      expect(result.distributionType).toBe("weighted");
    });

    it("throws on invalid distributionType", () => {
      expect(() =>
        validateInput(CreateTeamInput, { name: "Sales", distributionType: "INVALID" })
      ).toThrow("Invalid input");
    });
  });

  describe("AddTeamMemberInput", () => {
    it("passes with required fields", () => {
      const result = validateInput(AddTeamMemberInput, { teamId: "t1", userId: "u1" });
      expect(result.teamId).toBe("t1");
    });

    it("accepts optional weight", () => {
      const result = validateInput(AddTeamMemberInput, { teamId: "t1", userId: "u1", weight: 5 });
      expect(result.weight).toBe(5);
    });
  });

  describe("ObjectTypeEnum", () => {
    it("accepts valid values", () => {
      expect(ObjectTypeEnum.parse("LEAD")).toBe("LEAD");
      expect(ObjectTypeEnum.parse("CONTACT")).toBe("CONTACT");
      expect(ObjectTypeEnum.parse("ACCOUNT")).toBe("ACCOUNT");
      expect(ObjectTypeEnum.parse("COMPANY")).toBe("COMPANY");
      expect(ObjectTypeEnum.parse("DEAL")).toBe("DEAL");
    });

    it("rejects invalid value", () => {
      expect(() => ObjectTypeEnum.parse("INVALID")).toThrow();
    });
  });

  describe("ListUsersInput (optional schema)", () => {
    it("passes with undefined", () => {
      const result = validateInput(ListUsersInput, undefined);
      expect(result).toBeUndefined();
    });

    it("passes with empty object", () => {
      const result = validateInput(ListUsersInput, {});
      expect(result).toEqual({});
    });

    it("passes with query", () => {
      const result = validateInput(ListUsersInput, { query: "alice" });
      expect(result!.query).toBe("alice");
    });
  });
});
