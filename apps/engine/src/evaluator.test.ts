import { describe, it, expect } from 'vitest'
import { evaluateRule, type EvalCondition } from './evaluator.js'

// Helper to build a condition quickly
function cond(
  operator: string,
  fieldName: string,
  value: string | null,
  groupId = 'g1'
): EvalCondition {
  return { groupId, fieldName, operator, value }
}

// ─── Catch-all ────────────────────────────────────────────────────────────────

describe('catch-all (zero conditions)', () => {
  it('matches any record', () => {
    expect(evaluateRule({ FirstName: 'Alice' }, [])).toBe(true)
    expect(evaluateRule({}, [])).toBe(true)
  })
})

// ─── is_blank / is_not_blank ──────────────────────────────────────────────────

describe('is_blank', () => {
  it('matches null', () => expect(evaluateRule({ Phone: null }, [cond('is_blank', 'Phone', null)])).toBe(true))
  it('matches undefined (missing field)', () => expect(evaluateRule({}, [cond('is_blank', 'Phone', null)])).toBe(true))
  it('matches empty string', () => expect(evaluateRule({ Phone: '' }, [cond('is_blank', 'Phone', null)])).toBe(true))
  it('does not match non-empty string', () => expect(evaluateRule({ Phone: '555-1234' }, [cond('is_blank', 'Phone', null)])).toBe(false))
})

describe('is_not_blank', () => {
  it('matches non-empty string', () => expect(evaluateRule({ Phone: '555-1234' }, [cond('is_not_blank', 'Phone', null)])).toBe(true))
  it('does not match null', () => expect(evaluateRule({ Phone: null }, [cond('is_not_blank', 'Phone', null)])).toBe(false))
  it('does not match empty string', () => expect(evaluateRule({ Phone: '' }, [cond('is_not_blank', 'Phone', null)])).toBe(false))
  it('does not match missing field', () => expect(evaluateRule({}, [cond('is_not_blank', 'Phone', null)])).toBe(false))
})

// ─── is_true / is_false ───────────────────────────────────────────────────────

describe('is_true', () => {
  it('matches boolean true', () => expect(evaluateRule({ IsConverted: true }, [cond('is_true', 'IsConverted', null)])).toBe(true))
  it('matches string "true"', () => expect(evaluateRule({ IsConverted: 'true' }, [cond('is_true', 'IsConverted', null)])).toBe(true))
  it('matches string "True"', () => expect(evaluateRule({ IsConverted: 'True' }, [cond('is_true', 'IsConverted', null)])).toBe(true))
  it('does not match boolean false', () => expect(evaluateRule({ IsConverted: false }, [cond('is_true', 'IsConverted', null)])).toBe(false))
  it('does not match null', () => expect(evaluateRule({ IsConverted: null }, [cond('is_true', 'IsConverted', null)])).toBe(false))
})

describe('is_false', () => {
  it('matches boolean false', () => expect(evaluateRule({ IsConverted: false }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches string "false"', () => expect(evaluateRule({ IsConverted: 'false' }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches string "False"', () => expect(evaluateRule({ IsConverted: 'False' }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches null (blank = false)', () => expect(evaluateRule({ IsConverted: null }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches empty string (blank = false)', () => expect(evaluateRule({ IsConverted: '' }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('does not match boolean true', () => expect(evaluateRule({ IsConverted: true }, [cond('is_false', 'IsConverted', null)])).toBe(false))
})

// ─── equals / not_equals ─────────────────────────────────────────────────────

describe('equals', () => {
  it('matches same string', () => expect(evaluateRule({ LeadSource: 'Web' }, [cond('equals', 'LeadSource', 'Web')])).toBe(true))
  it('does not match different string', () => expect(evaluateRule({ LeadSource: 'API' }, [cond('equals', 'LeadSource', 'Web')])).toBe(false))
  it('matches number coerced to string', () => expect(evaluateRule({ Rating: 5 }, [cond('equals', 'Rating', '5')])).toBe(true))
  it('matches null field vs empty value', () => expect(evaluateRule({ LeadSource: null }, [cond('equals', 'LeadSource', '')])).toBe(true))
})

describe('not_equals', () => {
  it('matches different string', () => expect(evaluateRule({ LeadSource: 'API' }, [cond('not_equals', 'LeadSource', 'Web')])).toBe(true))
  it('does not match same string', () => expect(evaluateRule({ LeadSource: 'Web' }, [cond('not_equals', 'LeadSource', 'Web')])).toBe(false))
})

// ─── contains / not_contains ─────────────────────────────────────────────────

describe('contains', () => {
  it('matches substring (case-insensitive)', () => expect(evaluateRule({ Company: 'TechCorp' }, [cond('contains', 'Company', 'tech')])).toBe(true))
  it('matches uppercase input vs lowercase value', () => expect(evaluateRule({ Company: 'ACME' }, [cond('contains', 'Company', 'acme')])).toBe(true))
  it('does not match missing substring', () => expect(evaluateRule({ Company: 'Acme' }, [cond('contains', 'Company', 'tech')])).toBe(false))
  it('does not match null field', () => expect(evaluateRule({ Company: null }, [cond('contains', 'Company', 'tech')])).toBe(false))
})

describe('not_contains', () => {
  it('matches when substring absent', () => expect(evaluateRule({ Company: 'Acme' }, [cond('not_contains', 'Company', 'tech')])).toBe(true))
  it('does not match when substring present', () => expect(evaluateRule({ Company: 'TechCorp' }, [cond('not_contains', 'Company', 'tech')])).toBe(false))
})

// ─── starts_with ──────────────────────────────────────────────────────────────

describe('starts_with', () => {
  it('matches prefix (case-insensitive)', () => expect(evaluateRule({ Company: 'TechCorp' }, [cond('starts_with', 'Company', 'tech')])).toBe(true))
  it('does not match non-prefix', () => expect(evaluateRule({ Company: 'MyTech' }, [cond('starts_with', 'Company', 'tech')])).toBe(false))
  it('does not match null field', () => expect(evaluateRule({ Company: null }, [cond('starts_with', 'Company', 'tech')])).toBe(false))
})

// ─── gt / lt / gte / lte ─────────────────────────────────────────────────────

describe('gt', () => {
  it('matches when field > value (string coercion)', () => expect(evaluateRule({ AnnualRevenue: '100000' }, [cond('gt', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when equal', () => expect(evaluateRule({ AnnualRevenue: '50000' }, [cond('gt', 'AnnualRevenue', '50000')])).toBe(false))
  it('does not match when less', () => expect(evaluateRule({ AnnualRevenue: '10000' }, [cond('gt', 'AnnualRevenue', '50000')])).toBe(false))
})

describe('lt', () => {
  it('matches when field < value', () => expect(evaluateRule({ AnnualRevenue: '10000' }, [cond('lt', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when equal', () => expect(evaluateRule({ AnnualRevenue: '50000' }, [cond('lt', 'AnnualRevenue', '50000')])).toBe(false))
})

describe('gte', () => {
  it('matches when equal', () => expect(evaluateRule({ AnnualRevenue: '50000' }, [cond('gte', 'AnnualRevenue', '50000')])).toBe(true))
  it('matches when greater', () => expect(evaluateRule({ AnnualRevenue: '100000' }, [cond('gte', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when less', () => expect(evaluateRule({ AnnualRevenue: '10000' }, [cond('gte', 'AnnualRevenue', '50000')])).toBe(false))
})

describe('lte', () => {
  it('matches when equal', () => expect(evaluateRule({ AnnualRevenue: '50000' }, [cond('lte', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when greater', () => expect(evaluateRule({ AnnualRevenue: '100000' }, [cond('lte', 'AnnualRevenue', '50000')])).toBe(false))
})

// ─── before / after ───────────────────────────────────────────────────────────

describe('before', () => {
  it('matches date before cutoff', () => expect(evaluateRule({ CreatedDate: '2020-01-01T00:00:00Z' }, [cond('before', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(true))
  it('does not match date after cutoff', () => expect(evaluateRule({ CreatedDate: '2030-01-01T00:00:00Z' }, [cond('before', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(false))
})

describe('after', () => {
  it('matches date after cutoff', () => expect(evaluateRule({ CreatedDate: '2030-01-01T00:00:00Z' }, [cond('after', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(true))
  it('does not match date before cutoff', () => expect(evaluateRule({ CreatedDate: '2020-01-01T00:00:00Z' }, [cond('after', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(false))
})

// ─── within_last ─────────────────────────────────────────────────────────────

describe('within_last', () => {
  it('matches a date from today (0 days ago)', () => {
    const today = new Date().toISOString()
    expect(evaluateRule({ CreatedDate: today }, [cond('within_last', 'CreatedDate', '7')])).toBe(true)
  })
  it('matches a date from 3 days ago within a 7-day window', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()
    expect(evaluateRule({ CreatedDate: threeDaysAgo }, [cond('within_last', 'CreatedDate', '7')])).toBe(true)
  })
  it('does not match a date 10 days ago with a 7-day window', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString()
    expect(evaluateRule({ CreatedDate: tenDaysAgo }, [cond('within_last', 'CreatedDate', '7')])).toBe(false)
  })
})

// ─── includes / excludes ─────────────────────────────────────────────────────

describe('includes', () => {
  it('matches when all check values are in the field (single)', () => expect(evaluateRule({ Industry: 'Technology' }, [cond('includes', 'Industry', 'Technology')])).toBe(true))
  it('matches when all check values are in semicolon-separated field', () => expect(evaluateRule({ Industry: 'Technology;Finance' }, [cond('includes', 'Industry', 'Technology')])).toBe(true))
  it('matches when all multiple check values are present', () => expect(evaluateRule({ Industry: 'Technology;Finance;Healthcare' }, [cond('includes', 'Industry', 'Technology;Finance')])).toBe(true))
  it('does not match when a check value is missing', () => expect(evaluateRule({ Industry: 'Technology' }, [cond('includes', 'Industry', 'Technology;Finance')])).toBe(false))
  it('does not match null field', () => expect(evaluateRule({ Industry: null }, [cond('includes', 'Industry', 'Technology')])).toBe(false))
  it('does not match empty check value', () => expect(evaluateRule({ Industry: 'Technology' }, [cond('includes', 'Industry', '')])).toBe(false))
})

describe('excludes', () => {
  it('matches when no check values are in field', () => expect(evaluateRule({ Industry: 'Finance' }, [cond('excludes', 'Industry', 'Technology')])).toBe(true))
  it('does not match when a check value is present', () => expect(evaluateRule({ Industry: 'Technology;Finance' }, [cond('excludes', 'Industry', 'Technology')])).toBe(false))
  it('matches null field (nothing to exclude)', () => expect(evaluateRule({ Industry: null }, [cond('excludes', 'Industry', 'Technology')])).toBe(true))
})

// ─── Group logic (AND within / OR between) ───────────────────────────────────

describe('AND within group', () => {
  it('matches when all conditions in the group pass', () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'Rating', 'Hot', 'g1'),
    ]
    expect(evaluateRule({ LeadSource: 'Web', Rating: 'Hot' }, conditions)).toBe(true)
  })

  it('does not match when one condition in the group fails', () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'Rating', 'Hot', 'g1'),
    ]
    expect(evaluateRule({ LeadSource: 'Web', Rating: 'Cold' }, conditions)).toBe(false)
  })
})

describe('OR between groups', () => {
  it('matches when first group passes', () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'LeadSource', 'API', 'g2'),
    ]
    expect(evaluateRule({ LeadSource: 'Web' }, conditions)).toBe(true)
  })

  it('matches when second group passes (first fails)', () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'LeadSource', 'API', 'g2'),
    ]
    expect(evaluateRule({ LeadSource: 'API' }, conditions)).toBe(true)
  })

  it('does not match when no group passes', () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'LeadSource', 'API', 'g2'),
    ]
    expect(evaluateRule({ LeadSource: 'Email' }, conditions)).toBe(false)
  })
})

// ─── Field name case normalization ───────────────────────────────────────────

describe('field name case normalization', () => {
  it('matches lowercase field key sent by SFDC against Pascal-case condition', () => {
    // SFDC sends "leadsource", condition stores "LeadSource"
    expect(evaluateRule({ leadsource: 'Web' }, [cond('equals', 'LeadSource', 'Web')])).toBe(true)
  })
})

// ─── Unknown operator ────────────────────────────────────────────────────────

describe('unknown operator', () => {
  it('returns false (safe default)', () => {
    expect(evaluateRule({ LeadSource: 'Web' }, [cond('unknown_op', 'LeadSource', 'Web')])).toBe(false)
  })
})
