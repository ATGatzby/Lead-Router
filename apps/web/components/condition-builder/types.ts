export type FieldType =
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "DATETIME"
  | "BOOLEAN"
  | "PICKLIST"
  | "MULTI_PICKLIST"
  | "LOOKUP";

export interface FieldSchema {
  id: string;
  fieldApiName: string;
  fieldLabel: string;
  fieldType: FieldType;
  picklistValues: string[] | null;
}

export interface Condition {
  id: string; // client-only UUID
  groupId: string;
  fieldApiName: string;
  fieldType: FieldType;
  operator: string;
  value: string;
}

export interface ConditionGroup {
  id: string; // becomes groupId in DB
  conjunction: "AND" | "OR"; // logic WITHIN the group
  conditions: Condition[];
}

export type RuleConditions = ConditionGroup[];
