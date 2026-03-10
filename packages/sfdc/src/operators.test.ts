import { describe, it, expect } from "vitest";
import { getOperatorsForType, NO_VALUE_OPERATORS, OPERATORS } from "./operators.js";

describe("getOperatorsForType", () => {
  it('returns text operators for "TEXT"', () => {
    const ops = getOperatorsForType("TEXT");
    expect(ops).toBe(OPERATORS.TEXT);
    const values = ops.map((o) => o.value);
    expect(values).toContain("equals");
    expect(values).toContain("contains");
    expect(values).toContain("starts_with");
  });

  it('returns number operators for "NUMBER" including gt, lt, gte, lte', () => {
    const ops = getOperatorsForType("NUMBER");
    expect(ops).toBe(OPERATORS.NUMBER);
    const values = ops.map((o) => o.value);
    expect(values).toContain("gt");
    expect(values).toContain("lt");
    expect(values).toContain("gte");
    expect(values).toContain("lte");
  });

  it('returns boolean operators for "BOOLEAN"', () => {
    const ops = getOperatorsForType("BOOLEAN");
    expect(ops).toBe(OPERATORS.BOOLEAN);
    const values = ops.map((o) => o.value);
    expect(values).toEqual(["is_true", "is_false"]);
  });

  it('returns date operators for "DATE"', () => {
    const ops = getOperatorsForType("DATE");
    expect(ops).toBe(OPERATORS.DATE);
    const values = ops.map((o) => o.value);
    expect(values).toContain("before");
    expect(values).toContain("after");
    expect(values).toContain("within_last");
  });

  it('returns datetime operators for "DATETIME"', () => {
    const ops = getOperatorsForType("DATETIME");
    expect(ops).toBe(OPERATORS.DATETIME);
    const values = ops.map((o) => o.value);
    expect(values).toContain("before");
    expect(values).toContain("after");
    expect(values).toContain("within_last");
  });

  it('returns picklist operators for "PICKLIST"', () => {
    const ops = getOperatorsForType("PICKLIST");
    expect(ops).toBe(OPERATORS.PICKLIST);
    const values = ops.map((o) => o.value);
    expect(values).toContain("includes");
    expect(values).toContain("excludes");
  });

  it("falls back to TEXT operators for unknown type", () => {
    const ops = getOperatorsForType("UNKNOWN_TYPE");
    expect(ops).toBe(OPERATORS.TEXT);
  });
});

describe("NO_VALUE_OPERATORS", () => {
  it("contains is_blank, is_not_blank, is_true, is_false", () => {
    expect(NO_VALUE_OPERATORS.has("is_blank")).toBe(true);
    expect(NO_VALUE_OPERATORS.has("is_not_blank")).toBe(true);
    expect(NO_VALUE_OPERATORS.has("is_true")).toBe(true);
    expect(NO_VALUE_OPERATORS.has("is_false")).toBe(true);
  });

  it("does not contain regular operators", () => {
    expect(NO_VALUE_OPERATORS.has("equals")).toBe(false);
    expect(NO_VALUE_OPERATORS.has("contains")).toBe(false);
  });
});
