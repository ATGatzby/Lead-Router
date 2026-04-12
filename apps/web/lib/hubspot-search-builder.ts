// ─── HubSpot Search Builder ───────────────────────────────────────────────────
// Converts UI condition groups into HubSpot CRM Search API filter groups.

import type { FilterGroup, Filter, FilterOperator, SearchRequest } from "@lead-routing/hubspot";

interface SearchCondition {
  fieldApiName: string;
  fieldType?: string;
  operator: string;
  value: string | null;
}

interface SearchConditionGroup {
  id: string;
  conditions: SearchCondition[];
}

// Standard properties to fetch per object type
const STANDARD_PROPERTIES: Record<string, string[]> = {
  CONTACT: [
    "firstname", "lastname", "email", "phone", "mobilephone",
    "jobtitle", "company", "hubspot_owner_id",
    "createdate", "lastmodifieddate",
  ],
  COMPANY: [
    "name", "domain", "phone", "industry", "annualrevenue",
    "numberofemployees", "state", "country", "hubspot_owner_id",
    "createdate", "lastmodifieddate",
  ],
  DEAL: [
    "dealname", "amount", "dealstage", "closedate",
    "hubspot_owner_id", "createdate", "lastmodifieddate",
  ],
};

/**
 * Build a HubSpot CRM Search API request from search criteria.
 */
export function buildSearchRequest(
  objectType: string,
  criteria: SearchConditionGroup[] | null,
  limit: number = 100,
  properties?: string[]
): SearchRequest {
  const props = properties ?? STANDARD_PROPERTIES[objectType] ?? STANDARD_PROPERTIES.CONTACT;
  const filterGroups: FilterGroup[] = buildFilterGroups(criteria);

  return {
    filterGroups,
    properties: props,
    limit: Math.min(limit, 100),
  };
}

function buildFilterGroups(criteria: SearchConditionGroup[] | null): FilterGroup[] {
  if (!criteria || criteria.length === 0) return [];

  return criteria.map((group) => ({
    filters: group.conditions.map((c) => conditionToFilter(c)),
  }));
}

function conditionToFilter(cond: SearchCondition): Filter {
  const propertyName = cond.fieldApiName.replace(/[^a-zA-Z0-9_]/g, "");
  const value = cond.value ?? "";

  switch (cond.operator) {
    case "equals":
      return { propertyName, operator: "EQ" as FilterOperator, value };
    case "not_equals":
      return { propertyName, operator: "NEQ" as FilterOperator, value };
    case "contains":
      return { propertyName, operator: "CONTAINS_TOKEN" as FilterOperator, value };
    case "not_contains":
      return { propertyName, operator: "NOT_CONTAINS_TOKEN" as FilterOperator, value };
    case "greater_than":
    case "gt":
      return { propertyName, operator: "GT" as FilterOperator, value };
    case "less_than":
    case "lt":
      return { propertyName, operator: "LT" as FilterOperator, value };
    case "gte":
      return { propertyName, operator: "GTE" as FilterOperator, value };
    case "lte":
      return { propertyName, operator: "LTE" as FilterOperator, value };
    case "is_blank":
      return { propertyName, operator: "NOT_HAS_PROPERTY" as FilterOperator };
    case "is_not_blank":
      return { propertyName, operator: "HAS_PROPERTY" as FilterOperator };
    case "in":
    case "in_list":
      return {
        propertyName,
        operator: "IN" as FilterOperator,
        values: value.split(",").map((v) => v.trim()),
      };
    case "not_in":
      return {
        propertyName,
        operator: "NOT_IN" as FilterOperator,
        values: value.split(",").map((v) => v.trim()),
      };
    case "is_true":
      return { propertyName, operator: "EQ" as FilterOperator, value: "true" };
    case "is_false":
      return { propertyName, operator: "EQ" as FilterOperator, value: "false" };
    default:
      return { propertyName, operator: "EQ" as FilterOperator, value };
  }
}
