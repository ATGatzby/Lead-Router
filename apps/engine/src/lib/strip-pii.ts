const PII_FIELDS = new Set([
  "Email", "email", "PersonEmail",
  "Phone", "phone", "MobilePhone", "HomePhone", "Fax",
  "MailingStreet", "OtherStreet", "BillingStreet", "ShippingStreet",
  "Birthdate", "SSN__c", "Social_Security__c",
]);

export function stripPii(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (PII_FIELDS.has(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }
  return result;
}
