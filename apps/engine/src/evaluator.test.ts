import { describe, it, expect, vi } from 'vitest'
import { evaluateRule, type EvalCondition } from './evaluator.js'

// Mock the external dependencies so tests run without DB/Redis/AI
vi.mock('./lib/ai-client.js', () => ({
  resolveCompanySimilarity: vi.fn().mockResolvedValue(null),
}))

vi.mock('./lib/alias-cache.js', () => ({
  checkAliasCache: vi.fn().mockResolvedValue(null),
  cacheAliasResult: vi.fn().mockResolvedValue(undefined),
}))

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
  it('matches any record', async () => {
    expect(await evaluateRule({ FirstName: 'Alice' }, [])).toBe(true)
    expect(await evaluateRule({}, [])).toBe(true)
  })
})

// ─── is_blank / is_not_blank ──────────────────────────────────────────────────

describe('is_blank', () => {
  it('matches null', async () => expect(await evaluateRule({ Phone: null }, [cond('is_blank', 'Phone', null)])).toBe(true))
  it('matches undefined (missing field)', async () => expect(await evaluateRule({}, [cond('is_blank', 'Phone', null)])).toBe(true))
  it('matches empty string', async () => expect(await evaluateRule({ Phone: '' }, [cond('is_blank', 'Phone', null)])).toBe(true))
  it('does not match non-empty string', async () => expect(await evaluateRule({ Phone: '555-1234' }, [cond('is_blank', 'Phone', null)])).toBe(false))
})

describe('is_not_blank', () => {
  it('matches non-empty string', async () => expect(await evaluateRule({ Phone: '555-1234' }, [cond('is_not_blank', 'Phone', null)])).toBe(true))
  it('does not match null', async () => expect(await evaluateRule({ Phone: null }, [cond('is_not_blank', 'Phone', null)])).toBe(false))
  it('does not match empty string', async () => expect(await evaluateRule({ Phone: '' }, [cond('is_not_blank', 'Phone', null)])).toBe(false))
  it('does not match missing field', async () => expect(await evaluateRule({}, [cond('is_not_blank', 'Phone', null)])).toBe(false))
})

// ─── is_true / is_false ───────────────────────────────────────────────────────

describe('is_true', () => {
  it('matches boolean true', async () => expect(await evaluateRule({ IsConverted: true }, [cond('is_true', 'IsConverted', null)])).toBe(true))
  it('matches string "true"', async () => expect(await evaluateRule({ IsConverted: 'true' }, [cond('is_true', 'IsConverted', null)])).toBe(true))
  it('matches string "True"', async () => expect(await evaluateRule({ IsConverted: 'True' }, [cond('is_true', 'IsConverted', null)])).toBe(true))
  it('does not match boolean false', async () => expect(await evaluateRule({ IsConverted: false }, [cond('is_true', 'IsConverted', null)])).toBe(false))
  it('does not match null', async () => expect(await evaluateRule({ IsConverted: null }, [cond('is_true', 'IsConverted', null)])).toBe(false))
})

describe('is_false', () => {
  it('matches boolean false', async () => expect(await evaluateRule({ IsConverted: false }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches string "false"', async () => expect(await evaluateRule({ IsConverted: 'false' }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches string "False"', async () => expect(await evaluateRule({ IsConverted: 'False' }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches null (blank = false)', async () => expect(await evaluateRule({ IsConverted: null }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('matches empty string (blank = false)', async () => expect(await evaluateRule({ IsConverted: '' }, [cond('is_false', 'IsConverted', null)])).toBe(true))
  it('does not match boolean true', async () => expect(await evaluateRule({ IsConverted: true }, [cond('is_false', 'IsConverted', null)])).toBe(false))
})

// ─── equals / not_equals ─────────────────────────────────────────────────────

describe('equals', () => {
  it('matches same string', async () => expect(await evaluateRule({ LeadSource: 'Web' }, [cond('equals', 'LeadSource', 'Web')])).toBe(true))
  it('does not match different string', async () => expect(await evaluateRule({ LeadSource: 'API' }, [cond('equals', 'LeadSource', 'Web')])).toBe(false))
  it('matches number coerced to string', async () => expect(await evaluateRule({ Rating: 5 }, [cond('equals', 'Rating', '5')])).toBe(true))
  it('matches null field vs empty value', async () => expect(await evaluateRule({ LeadSource: null }, [cond('equals', 'LeadSource', '')])).toBe(true))
})

describe('not_equals', () => {
  it('matches different string', async () => expect(await evaluateRule({ LeadSource: 'API' }, [cond('not_equals', 'LeadSource', 'Web')])).toBe(true))
  it('does not match same string', async () => expect(await evaluateRule({ LeadSource: 'Web' }, [cond('not_equals', 'LeadSource', 'Web')])).toBe(false))
})

// ─── contains / not_contains ─────────────────────────────────────────────────

describe('contains', () => {
  it('matches substring (case-insensitive)', async () => expect(await evaluateRule({ Company: 'TechCorp' }, [cond('contains', 'Company', 'tech')])).toBe(true))
  it('matches uppercase input vs lowercase value', async () => expect(await evaluateRule({ Company: 'ACME' }, [cond('contains', 'Company', 'acme')])).toBe(true))
  it('does not match missing substring', async () => expect(await evaluateRule({ Company: 'Acme' }, [cond('contains', 'Company', 'tech')])).toBe(false))
  it('does not match null field', async () => expect(await evaluateRule({ Company: null }, [cond('contains', 'Company', 'tech')])).toBe(false))
})

describe('not_contains', () => {
  it('matches when substring absent', async () => expect(await evaluateRule({ Company: 'Acme' }, [cond('not_contains', 'Company', 'tech')])).toBe(true))
  it('does not match when substring present', async () => expect(await evaluateRule({ Company: 'TechCorp' }, [cond('not_contains', 'Company', 'tech')])).toBe(false))
})

// ─── starts_with ──────────────────────────────────────────────────────────────

describe('starts_with', () => {
  it('matches prefix (case-insensitive)', async () => expect(await evaluateRule({ Company: 'TechCorp' }, [cond('starts_with', 'Company', 'tech')])).toBe(true))
  it('does not match non-prefix', async () => expect(await evaluateRule({ Company: 'MyTech' }, [cond('starts_with', 'Company', 'tech')])).toBe(false))
  it('does not match null field', async () => expect(await evaluateRule({ Company: null }, [cond('starts_with', 'Company', 'tech')])).toBe(false))
})

// ─── gt / lt / gte / lte ─────────────────────────────────────────────────────

describe('gt', () => {
  it('matches when field > value (string coercion)', async () => expect(await evaluateRule({ AnnualRevenue: '100000' }, [cond('gt', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when equal', async () => expect(await evaluateRule({ AnnualRevenue: '50000' }, [cond('gt', 'AnnualRevenue', '50000')])).toBe(false))
  it('does not match when less', async () => expect(await evaluateRule({ AnnualRevenue: '10000' }, [cond('gt', 'AnnualRevenue', '50000')])).toBe(false))
})

describe('lt', () => {
  it('matches when field < value', async () => expect(await evaluateRule({ AnnualRevenue: '10000' }, [cond('lt', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when equal', async () => expect(await evaluateRule({ AnnualRevenue: '50000' }, [cond('lt', 'AnnualRevenue', '50000')])).toBe(false))
})

describe('gte', () => {
  it('matches when equal', async () => expect(await evaluateRule({ AnnualRevenue: '50000' }, [cond('gte', 'AnnualRevenue', '50000')])).toBe(true))
  it('matches when greater', async () => expect(await evaluateRule({ AnnualRevenue: '100000' }, [cond('gte', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when less', async () => expect(await evaluateRule({ AnnualRevenue: '10000' }, [cond('gte', 'AnnualRevenue', '50000')])).toBe(false))
})

describe('lte', () => {
  it('matches when equal', async () => expect(await evaluateRule({ AnnualRevenue: '50000' }, [cond('lte', 'AnnualRevenue', '50000')])).toBe(true))
  it('does not match when greater', async () => expect(await evaluateRule({ AnnualRevenue: '100000' }, [cond('lte', 'AnnualRevenue', '50000')])).toBe(false))
})

// ─── before / after ───────────────────────────────────────────────────────────

describe('before', () => {
  it('matches date before cutoff', async () => expect(await evaluateRule({ CreatedDate: '2020-01-01T00:00:00Z' }, [cond('before', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(true))
  it('does not match date after cutoff', async () => expect(await evaluateRule({ CreatedDate: '2030-01-01T00:00:00Z' }, [cond('before', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(false))
})

describe('after', () => {
  it('matches date after cutoff', async () => expect(await evaluateRule({ CreatedDate: '2030-01-01T00:00:00Z' }, [cond('after', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(true))
  it('does not match date before cutoff', async () => expect(await evaluateRule({ CreatedDate: '2020-01-01T00:00:00Z' }, [cond('after', 'CreatedDate', '2025-01-01T00:00:00Z')])).toBe(false))
})

// ─── within_last ─────────────────────────────────────────────────────────────

describe('within_last', () => {
  it('matches a date from today (0 days ago)', async () => {
    const today = new Date().toISOString()
    expect(await evaluateRule({ CreatedDate: today }, [cond('within_last', 'CreatedDate', '7')])).toBe(true)
  })
  it('matches a date from 3 days ago within a 7-day window', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()
    expect(await evaluateRule({ CreatedDate: threeDaysAgo }, [cond('within_last', 'CreatedDate', '7')])).toBe(true)
  })
  it('does not match a date 10 days ago with a 7-day window', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString()
    expect(await evaluateRule({ CreatedDate: tenDaysAgo }, [cond('within_last', 'CreatedDate', '7')])).toBe(false)
  })
})

// ─── includes / excludes ─────────────────────────────────────────────────────

describe('includes', () => {
  it('matches when all check values are in the field (single)', async () => expect(await evaluateRule({ Industry: 'Technology' }, [cond('includes', 'Industry', 'Technology')])).toBe(true))
  it('matches when all check values are in semicolon-separated field', async () => expect(await evaluateRule({ Industry: 'Technology;Finance' }, [cond('includes', 'Industry', 'Technology')])).toBe(true))
  it('matches when all multiple check values are present', async () => expect(await evaluateRule({ Industry: 'Technology;Finance;Healthcare' }, [cond('includes', 'Industry', 'Technology;Finance')])).toBe(true))
  it('does not match when a check value is missing', async () => expect(await evaluateRule({ Industry: 'Technology' }, [cond('includes', 'Industry', 'Technology;Finance')])).toBe(false))
  it('does not match null field', async () => expect(await evaluateRule({ Industry: null }, [cond('includes', 'Industry', 'Technology')])).toBe(false))
  it('does not match empty check value', async () => expect(await evaluateRule({ Industry: 'Technology' }, [cond('includes', 'Industry', '')])).toBe(false))
})

describe('excludes', () => {
  it('matches when no check values are in field', async () => expect(await evaluateRule({ Industry: 'Finance' }, [cond('excludes', 'Industry', 'Technology')])).toBe(true))
  it('does not match when a check value is present', async () => expect(await evaluateRule({ Industry: 'Technology;Finance' }, [cond('excludes', 'Industry', 'Technology')])).toBe(false))
  it('matches null field (nothing to exclude)', async () => expect(await evaluateRule({ Industry: null }, [cond('excludes', 'Industry', 'Technology')])).toBe(true))
})

// ─── Group logic (AND within / OR between) ───────────────────────────────────

describe('AND within group', () => {
  it('matches when all conditions in the group pass', async () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'Rating', 'Hot', 'g1'),
    ]
    expect(await evaluateRule({ LeadSource: 'Web', Rating: 'Hot' }, conditions)).toBe(true)
  })

  it('does not match when one condition in the group fails', async () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'Rating', 'Hot', 'g1'),
    ]
    expect(await evaluateRule({ LeadSource: 'Web', Rating: 'Cold' }, conditions)).toBe(false)
  })
})

describe('OR between groups', () => {
  it('matches when first group passes', async () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'LeadSource', 'API', 'g2'),
    ]
    expect(await evaluateRule({ LeadSource: 'Web' }, conditions)).toBe(true)
  })

  it('matches when second group passes (first fails)', async () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'LeadSource', 'API', 'g2'),
    ]
    expect(await evaluateRule({ LeadSource: 'API' }, conditions)).toBe(true)
  })

  it('does not match when no group passes', async () => {
    const conditions: EvalCondition[] = [
      cond('equals', 'LeadSource', 'Web', 'g1'),
      cond('equals', 'LeadSource', 'API', 'g2'),
    ]
    expect(await evaluateRule({ LeadSource: 'Email' }, conditions)).toBe(false)
  })
})

// ─── Field name case normalization ───────────────────────────────────────────

describe('field name case normalization', () => {
  it('matches lowercase field key sent by SFDC against Pascal-case condition', async () => {
    // SFDC sends "leadsource", condition stores "LeadSource"
    expect(await evaluateRule({ leadsource: 'Web' }, [cond('equals', 'LeadSource', 'Web')])).toBe(true)
  })
})

// ─── Unknown operator ────────────────────────────────────────────────────────

describe('unknown operator', () => {
  it('returns false (safe default)', async () => {
    expect(await evaluateRule({ LeadSource: 'Web' }, [cond('unknown_op', 'LeadSource', 'Web')])).toBe(false)
  })
})

// ─── Fuzzy operators (Phase 3) ──────────────────────────────────────────────

describe('fuzzy_equals', () => {
  it('"Microsft" fuzzy_equals "Microsoft" → true (typo within threshold)', async () => {
    expect(await evaluateRule({ Company: 'Microsft' }, [cond('fuzzy_equals', 'Company', 'Microsoft')])).toBe(true)
  })

  it('"Apple" fuzzy_equals "Google" → false (completely different)', async () => {
    expect(await evaluateRule({ Company: 'Apple' }, [cond('fuzzy_equals', 'Company', 'Google')])).toBe(false)
  })

  it('handles case insensitivity', async () => {
    expect(await evaluateRule({ Company: 'MICROSOFT' }, [cond('fuzzy_equals', 'Company', 'microsoft')])).toBe(true)
  })

  it('handles null field gracefully', async () => {
    expect(await evaluateRule({ Company: null }, [cond('fuzzy_equals', 'Company', 'Microsoft')])).toBe(false)
  })
})

describe('sounds_like', () => {
  it('"Robert" sounds_like "Rupert" → true (similar phonetics)', async () => {
    expect(await evaluateRule({ FirstName: 'Robert' }, [cond('sounds_like', 'FirstName', 'Rupert')])).toBe(true)
  })

  it('"Smith" sounds_like "Jones" → false (different phonetics)', async () => {
    expect(await evaluateRule({ LastName: 'Smith' }, [cond('sounds_like', 'LastName', 'Jones')])).toBe(false)
  })

  it('"Catherine" sounds_like "Katherine" → true (same soundex)', async () => {
    expect(await evaluateRule({ FirstName: 'Catherine' }, [cond('sounds_like', 'FirstName', 'Katherine')])).toBe(true)
  })

  it('handles empty strings', async () => {
    expect(await evaluateRule({ FirstName: '' }, [cond('sounds_like', 'FirstName', '')])).toBe(false)
  })
})

describe('similar_to', () => {
  it('"IBM" similar_to "International Business Machines" → true (via abbreviation)', async () => {
    expect(await evaluateRule({ Company: 'IBM' }, [cond('similar_to', 'Company', 'International Business Machines')])).toBe(true)
  })

  it('"Microsft Inc" similar_to "Microsoft" → true (via fuzzy match)', async () => {
    expect(await evaluateRule({ Company: 'Microsft Inc' }, [cond('similar_to', 'Company', 'Microsoft')])).toBe(true)
  })

  it('"Apple" similar_to "Google" → false', async () => {
    expect(await evaluateRule({ Company: 'Apple' }, [cond('similar_to', 'Company', 'Google')])).toBe(false)
  })

  it('"HP" similar_to "Hewlett Packard" → true (via abbreviation)', async () => {
    expect(await evaluateRule({ Company: 'HP' }, [cond('similar_to', 'Company', 'Hewlett Packard')])).toBe(true)
  })

  it('"Microsoft Corporation" similar_to "Microsoft Inc" → true (same after suffix strip)', async () => {
    expect(await evaluateRule({ Company: 'Microsoft Corporation' }, [cond('similar_to', 'Company', 'Microsoft Inc')])).toBe(true)
  })
})
