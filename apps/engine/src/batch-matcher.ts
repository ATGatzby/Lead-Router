// jsforce Connection type — use 'any' to avoid type-only import issues with tsup bundling
type SfdcConnection = any;

// ─── Types ────────────────────────────────────────────────────────────────

export interface BatchMatchInput {
  recordId: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface BatchMatchResult {
  matchedType: "LEAD" | "CONTACT" | "ACCOUNT";
  matchedRecordId: string;
  ownerId: string;
  matchField: string;
}

export interface CachedMatchConfig {
  checkLeads: boolean;
  checkContacts: boolean;
  checkAccounts: boolean;
  matchEmail: boolean;
  matchPhone: boolean;
  matchDomain: boolean;
  matchCompanyName: boolean;
  fuzzyMatchMode: string;
  onLeadMatch: string;
  leadAssignmentType?: string | null;
  leadAssigneeUserId?: string | null;
  leadAssigneeTeamId?: string | null;
  leadAssigneeQueueId?: string | null;
  onContactMatch: string;
  contactAssignmentType?: string | null;
  contactAssigneeUserId?: string | null;
  contactAssigneeTeamId?: string | null;
  contactAssigneeQueueId?: string | null;
  onAccountMatch: string;
  accountAssignmentType?: string | null;
  accountAssigneeUserId?: string | null;
  accountAssigneeTeamId?: string | null;
  accountAssigneeQueueId?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Split an array into chunks of a given size. */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Escape a string for use inside a SOQL single-quoted literal. */
export function escapeSoql(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Normalize a company name for strict comparison. */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Maximum number of values per IN clause to stay within SOQL length limits
const IN_CLAUSE_CHUNK_SIZE = 200;

// ─── SOQL batch query helpers ─────────────────────────────────────────────

interface SfdcRecord {
  Id: string;
  OwnerId: string;
  Email?: string;
  Phone?: string;
  Website?: string;
  Name?: string;
}

/**
 * Run a SOQL query with an IN clause, chunking to stay within limits.
 * Returns all matching records across all chunks.
 */
async function queryWithInClause(
  conn: SfdcConnection,
  objectName: string,
  fieldName: string,
  values: string[],
  selectFields: string[],
  extraWhere?: string
): Promise<SfdcRecord[]> {
  const chunks = chunkArray(values, IN_CLAUSE_CHUNK_SIZE);
  const allRecords: SfdcRecord[] = [];

  for (const chunk of chunks) {
    const inList = chunk.map((v) => `'${escapeSoql(v)}'`).join(",");
    const whereClause = extraWhere
      ? `${fieldName} IN (${inList}) AND ${extraWhere}`
      : `${fieldName} IN (${inList})`;
    const soql = `SELECT ${selectFields.join(",")} FROM ${objectName} WHERE ${whereClause}`;

    try {
      const result = await conn.query<SfdcRecord>(soql);
      if (result.records) {
        allRecords.push(...result.records);
      }
    } catch (err) {
      console.error(`[batch-matcher] SOQL query error for ${objectName}:`, err);
    }
  }

  return allRecords;
}

// ─── Main batch matcher ──────────────────────────────────────────────────

/**
 * Match a batch of records against Salesforce using efficient IN-clause queries
 * instead of per-record lookups.
 *
 * Returns a Map from recordId to BatchMatchResult (or null if no match found).
 */
export async function batchMatchRecords(
  conn: SfdcConnection,
  records: Array<{ recordId: string; fields: Record<string, unknown> }>,
  matchConfig: CachedMatchConfig
): Promise<Map<string, BatchMatchResult | null>> {
  const results = new Map<string, BatchMatchResult | null>();

  // Initialize all records to null
  for (const rec of records) {
    results.set(rec.recordId, null);
  }

  if (records.length === 0) return results;

  // ─── Extract unique field values from input records ───────────────────

  const emailByRecord = new Map<string, string>();
  const phoneByRecord = new Map<string, string>();
  const domainByRecord = new Map<string, string>();
  const companyByRecord = new Map<string, string>();

  for (const rec of records) {
    const email = String(rec.fields["Email"] ?? rec.fields["email"] ?? "")
      .toLowerCase()
      .trim();
    const phone = String(
      rec.fields["Phone"] ?? rec.fields["phone"] ?? rec.fields["MobilePhone"] ?? ""
    ).trim();
    const company = String(rec.fields["Company"] ?? rec.fields["company"] ?? "").trim();

    if (email) {
      emailByRecord.set(rec.recordId, email);
      if (email.includes("@")) {
        domainByRecord.set(rec.recordId, email.split("@")[1]!);
      }
    }
    if (phone) phoneByRecord.set(rec.recordId, phone);
    if (company) companyByRecord.set(rec.recordId, company);
  }

  const uniqueEmails = [...new Set(emailByRecord.values())];
  const uniquePhones = [...new Set(phoneByRecord.values())];
  const uniqueDomains = [...new Set(domainByRecord.values())];

  // ─── Build lookup maps from batch SOQL queries ────────────────────────

  // Maps: fieldValue (lowercase) → { Id, OwnerId }
  const leadsByEmail = new Map<string, SfdcRecord>();
  const contactsByEmail = new Map<string, SfdcRecord>();
  const leadsByPhone = new Map<string, SfdcRecord>();
  const contactsByPhone = new Map<string, SfdcRecord>();
  const accountsByDomain = new Map<string, SfdcRecord>();

  // 1. Email-based Lead lookup
  if (matchConfig.matchEmail && matchConfig.checkLeads && uniqueEmails.length > 0) {
    const records = await queryWithInClause(
      conn,
      "Lead",
      "Email",
      uniqueEmails,
      ["Id", "OwnerId", "Email"],
      "IsConverted = false"
    );
    for (const rec of records) {
      if (rec.Email) {
        const key = rec.Email.toLowerCase();
        if (!leadsByEmail.has(key)) leadsByEmail.set(key, rec);
      }
    }
  }

  // 2. Email-based Contact lookup
  if (matchConfig.matchEmail && matchConfig.checkContacts && uniqueEmails.length > 0) {
    const records = await queryWithInClause(
      conn,
      "Contact",
      "Email",
      uniqueEmails,
      ["Id", "OwnerId", "Email"]
    );
    for (const rec of records) {
      if (rec.Email) {
        const key = rec.Email.toLowerCase();
        if (!contactsByEmail.has(key)) contactsByEmail.set(key, rec);
      }
    }
  }

  // 3. Domain-based Account lookup
  // SOQL can't efficiently do multi-LIKE, so we query all accounts with
  // non-null websites and filter in JS.
  if (matchConfig.matchDomain && matchConfig.checkAccounts && uniqueDomains.length > 0) {
    // Build a set of OR conditions: Website LIKE '%domain1%' OR Website LIKE '%domain2%'
    // Chunk domains to avoid overly long SOQL
    const domainChunks = chunkArray(uniqueDomains, IN_CLAUSE_CHUNK_SIZE);
    for (const chunk of domainChunks) {
      const likeConditions = chunk
        .map((d) => `Website LIKE '%${escapeSoql(d)}%'`)
        .join(" OR ");
      const soql = `SELECT Id, OwnerId, Website FROM Account WHERE Website != null AND (${likeConditions})`;
      try {
        const result = await conn.query<SfdcRecord>(soql);
        if (result.records) {
          for (const rec of result.records) {
            if (!rec.Website) continue;
            const website = rec.Website.toLowerCase();
            // Check which domains match this website
            for (const domain of chunk) {
              if (website.includes(domain.toLowerCase()) && !accountsByDomain.has(domain.toLowerCase())) {
                accountsByDomain.set(domain.toLowerCase(), rec);
              }
            }
          }
        }
      } catch (err) {
        console.error("[batch-matcher] Account domain SOQL error:", err);
      }
    }
  }

  // 4. Phone-based Lead lookup
  if (matchConfig.matchPhone && matchConfig.checkLeads && uniquePhones.length > 0) {
    const records = await queryWithInClause(
      conn,
      "Lead",
      "Phone",
      uniquePhones,
      ["Id", "OwnerId", "Phone"],
      "IsConverted = false"
    );
    for (const rec of records) {
      if (rec.Phone) {
        if (!leadsByPhone.has(rec.Phone)) leadsByPhone.set(rec.Phone, rec);
      }
    }
  }

  // 5. Phone-based Contact lookup
  if (matchConfig.matchPhone && matchConfig.checkContacts && uniquePhones.length > 0) {
    const records = await queryWithInClause(
      conn,
      "Contact",
      "Phone",
      uniquePhones,
      ["Id", "OwnerId", "Phone"]
    );
    for (const rec of records) {
      if (rec.Phone) {
        if (!contactsByPhone.has(rec.Phone)) contactsByPhone.set(rec.Phone, rec);
      }
    }
  }

  // 6. Company name matching (STRICT mode only — FUZZY/AI_SMART not batchable)
  const accountsByNormalizedName = new Map<string, SfdcRecord>();
  if (
    matchConfig.matchCompanyName &&
    matchConfig.checkAccounts &&
    matchConfig.fuzzyMatchMode === "STRICT" &&
    companyByRecord.size > 0
  ) {
    const uniqueCompanies = [...new Set(companyByRecord.values())];
    // Normalize for exact matching — query using IN on Name
    const normalizedToOriginal = new Map<string, string>();
    for (const c of uniqueCompanies) {
      normalizedToOriginal.set(normalizeCompanyName(c), c);
    }

    const records = await queryWithInClause(
      conn,
      "Account",
      "Name",
      uniqueCompanies,
      ["Id", "OwnerId", "Name"]
    );
    for (const rec of records) {
      if (rec.Name) {
        const key = normalizeCompanyName(rec.Name);
        if (!accountsByNormalizedName.has(key)) {
          accountsByNormalizedName.set(key, rec);
        }
      }
    }
  }

  // ─── Resolve matches per record in priority order ─────────────────────

  for (const rec of records) {
    const email = emailByRecord.get(rec.recordId);
    const phone = phoneByRecord.get(rec.recordId);
    const domain = domainByRecord.get(rec.recordId);
    const company = companyByRecord.get(rec.recordId);

    // Priority 1: Lead by email
    if (email) {
      const lead = leadsByEmail.get(email);
      if (lead) {
        results.set(rec.recordId, {
          matchedType: "LEAD",
          matchedRecordId: lead.Id,
          ownerId: lead.OwnerId,
          matchField: "Email",
        });
        continue;
      }
    }

    // Priority 2: Contact by email
    if (email) {
      const contact = contactsByEmail.get(email);
      if (contact) {
        results.set(rec.recordId, {
          matchedType: "CONTACT",
          matchedRecordId: contact.Id,
          ownerId: contact.OwnerId,
          matchField: "Email",
        });
        continue;
      }
    }

    // Priority 3: Account by domain
    if (domain) {
      const account = accountsByDomain.get(domain.toLowerCase());
      if (account) {
        results.set(rec.recordId, {
          matchedType: "ACCOUNT",
          matchedRecordId: account.Id,
          ownerId: account.OwnerId,
          matchField: "Domain",
        });
        continue;
      }
    }

    // Priority 4: Lead by phone
    if (phone) {
      const lead = leadsByPhone.get(phone);
      if (lead) {
        results.set(rec.recordId, {
          matchedType: "LEAD",
          matchedRecordId: lead.Id,
          ownerId: lead.OwnerId,
          matchField: "Phone",
        });
        continue;
      }
    }

    // Priority 5: Contact by phone
    if (phone) {
      const contact = contactsByPhone.get(phone);
      if (contact) {
        results.set(rec.recordId, {
          matchedType: "CONTACT",
          matchedRecordId: contact.Id,
          ownerId: contact.OwnerId,
          matchField: "Phone",
        });
        continue;
      }
    }

    // Priority 6: Account by company name (STRICT only)
    if (company && matchConfig.fuzzyMatchMode === "STRICT") {
      const normalized = normalizeCompanyName(company);
      const account = accountsByNormalizedName.get(normalized);
      if (account) {
        results.set(rec.recordId, {
          matchedType: "ACCOUNT",
          matchedRecordId: account.Id,
          ownerId: account.OwnerId,
          matchField: "CompanyName",
        });
        continue;
      }
    }

    // No match — already null from initialization
  }

  return results;
}
