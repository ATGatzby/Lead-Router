export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public remediation: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export class NotFoundError extends AgentError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} "${id}" not found`, `Check the ID and try again.`);
  }
}

export class CrmUnsupportedError extends AgentError {
  constructor(feature: string, crmType: string) {
    super(
      "CRM_UNSUPPORTED",
      `${feature} is not available for ${crmType}`,
      `This feature is only supported for ${crmType === "HUBSPOT" ? "Salesforce" : "HubSpot"} orgs.`,
    );
  }
}

export class ValidationError extends AgentError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, "Check the input parameters and try again.");
  }
}

export class EngineGatewayRequiredError extends AgentError {
  constructor() {
    super(
      "ENGINE_GATEWAY_REQUIRED",
      "Engine gateway is not configured in the agent context",
      "Provide an engineGateway in the AgentContext when calling routing actions.",
    );
  }
}
