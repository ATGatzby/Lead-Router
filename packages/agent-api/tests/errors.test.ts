import { describe, it, expect } from "vitest";
import {
  AgentError,
  NotFoundError,
  CrmUnsupportedError,
  ValidationError,
  EngineGatewayRequiredError,
} from "../src/errors.js";

describe("AgentError", () => {
  it("stores code, message, and remediation", () => {
    const err = new AgentError("TEST_CODE", "Something broke", "Fix it");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("Something broke");
    expect(err.remediation).toBe("Fix it");
    expect(err.name).toBe("AgentError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("NotFoundError", () => {
  it("formats entity and id", () => {
    const err = new NotFoundError("Team", "t123");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe('Team "t123" not found');
    expect(err.remediation).toContain("Check the ID");
  });
});

describe("CrmUnsupportedError", () => {
  it("suggests alternative CRM for HUBSPOT", () => {
    const err = new CrmUnsupportedError("Queue sync", "HUBSPOT");
    expect(err.code).toBe("CRM_UNSUPPORTED");
    expect(err.message).toContain("HUBSPOT");
    expect(err.remediation).toContain("Salesforce");
  });

  it("suggests alternative CRM for SALESFORCE", () => {
    const err = new CrmUnsupportedError("Some feature", "SALESFORCE");
    expect(err.remediation).toContain("HubSpot");
  });
});

describe("ValidationError", () => {
  it("has VALIDATION_ERROR code", () => {
    const err = new ValidationError("Invalid input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Invalid input");
  });
});

describe("EngineGatewayRequiredError", () => {
  it("has ENGINE_GATEWAY_REQUIRED code", () => {
    const err = new EngineGatewayRequiredError();
    expect(err.code).toBe("ENGINE_GATEWAY_REQUIRED");
  });
});
