/**
 * D1 query helpers for the licenses table.
 */

export interface License {
  id: string
  key: string
  jwt: string
  email: string
  tier: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  validUntil: string
  graceUntil: string | null
  serverFingerprint: string | null
  lastHeartbeat: string | null
  isActive: number
  createdAt: string
  updatedAt: string
}

export interface CreateLicenseData {
  id: string
  key: string
  jwt: string
  email: string
  tier: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  validUntil: string
}

export async function findLicenseByKey(db: D1Database, key: string): Promise<License | null> {
  const result = await db
    .prepare('SELECT * FROM licenses WHERE key = ?')
    .bind(key)
    .first<License>()
  return result ?? null
}

export async function findLicenseById(db: D1Database, id: string): Promise<License | null> {
  const result = await db
    .prepare('SELECT * FROM licenses WHERE id = ?')
    .bind(id)
    .first<License>()
  return result ?? null
}

export async function findLicenseBySubscriptionId(
  db: D1Database,
  subscriptionId: string
): Promise<License | null> {
  const result = await db
    .prepare('SELECT * FROM licenses WHERE stripeSubscriptionId = ?')
    .bind(subscriptionId)
    .first<License>()
  return result ?? null
}

export async function createLicense(db: D1Database, data: CreateLicenseData): Promise<void> {
  await db
    .prepare(
      `INSERT INTO licenses (id, key, jwt, email, tier, stripeCustomerId, stripeSubscriptionId, validUntil)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.key,
      data.jwt,
      data.email,
      data.tier,
      data.stripeCustomerId,
      data.stripeSubscriptionId,
      data.validUntil
    )
    .run()
}

export async function updateLicenseHeartbeat(
  db: D1Database,
  key: string,
  timestamp: string
): Promise<void> {
  await db
    .prepare("UPDATE licenses SET lastHeartbeat = ?, updatedAt = datetime('now') WHERE key = ?")
    .bind(timestamp, key)
    .run()
}

export async function updateLicenseFingerprint(
  db: D1Database,
  key: string,
  fingerprint: string
): Promise<void> {
  await db
    .prepare("UPDATE licenses SET serverFingerprint = ?, updatedAt = datetime('now') WHERE key = ?")
    .bind(fingerprint, key)
    .run()
}

export async function extendLicenseValidity(
  db: D1Database,
  subscriptionId: string,
  newValidUntil: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE licenses SET validUntil = ?, graceUntil = NULL, updatedAt = datetime('now') WHERE stripeSubscriptionId = ?"
    )
    .bind(newValidUntil, subscriptionId)
    .run()
}

export async function setGracePeriod(
  db: D1Database,
  subscriptionId: string,
  graceUntil: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE licenses SET graceUntil = ?, updatedAt = datetime('now') WHERE stripeSubscriptionId = ?"
    )
    .bind(graceUntil, subscriptionId)
    .run()
}

// -- Customer types -----------------------------------------------------------

export interface Customer {
  id: string
  email: string
  firstName: string
  lastName: string
  passwordHash: string
  passwordSalt: string
  tier: string
  stripeCustomerId: string | null
  licenseId: string | null
  emailVerified: number
  emailVerifyToken: string | null
  emailVerifyExpiry: string | null
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
}

export interface CreateCustomerData {
  id: string
  email: string
  firstName: string
  lastName: string
  passwordHash: string
  passwordSalt: string
  tier?: string
  emailVerified?: number
  emailVerifyToken?: string
  emailVerifyExpiry?: string
  stripeCustomerId?: string
  licenseId?: string
}

// -- Customer CRUD ------------------------------------------------------------

export async function findCustomerByEmail(db: D1Database, email: string): Promise<Customer | null> {
  const result = await db
    .prepare('SELECT * FROM customers WHERE email = ?')
    .bind(email)
    .first<Customer>()
  return result ?? null
}

export async function findCustomerById(db: D1Database, id: string): Promise<Customer | null> {
  const result = await db
    .prepare('SELECT * FROM customers WHERE id = ?')
    .bind(id)
    .first<Customer>()
  return result ?? null
}

export async function createCustomer(db: D1Database, data: CreateCustomerData): Promise<void> {
  await db
    .prepare(
      `INSERT INTO customers (id, email, firstName, lastName, passwordHash, passwordSalt, tier, emailVerified, emailVerifyToken, emailVerifyExpiry, stripeCustomerId, licenseId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.email,
      data.firstName,
      data.lastName,
      data.passwordHash,
      data.passwordSalt,
      data.tier ?? 'free',
      data.emailVerified ?? 0,
      data.emailVerifyToken ?? null,
      data.emailVerifyExpiry ?? null,
      data.stripeCustomerId ?? null,
      data.licenseId ?? null
    )
    .run()
}

export async function updateCustomerTier(
  db: D1Database,
  email: string,
  tier: string,
  licenseId: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE customers SET tier = ?, licenseId = ?, updatedAt = datetime('now') WHERE email = ?"
    )
    .bind(tier, licenseId, email)
    .run()
}

export async function updateCustomerLogin(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE customers SET lastLoginAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?"
    )
    .bind(id)
    .run()
}

export async function verifyCustomerEmail(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE customers SET emailVerified = 1, emailVerifyToken = NULL, emailVerifyExpiry = NULL, updatedAt = datetime('now') WHERE id = ?"
    )
    .bind(id)
    .run()
}

export async function setEmailVerifyToken(
  db: D1Database,
  id: string,
  token: string,
  expiry: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE customers SET emailVerifyToken = ?, emailVerifyExpiry = ?, updatedAt = datetime('now') WHERE id = ?"
    )
    .bind(token, expiry, id)
    .run()
}

export async function findCustomerByVerifyToken(
  db: D1Database,
  token: string
): Promise<Customer | null> {
  const result = await db
    .prepare('SELECT * FROM customers WHERE emailVerifyToken = ?')
    .bind(token)
    .first<Customer>()
  return result ?? null
}

// -- Customer admin queries ---------------------------------------------------

export async function getAllCustomers(
  db: D1Database,
  limit: number,
  offset: number,
  search?: string,
  tier?: string
): Promise<Customer[]> {
  let query = 'SELECT * FROM customers'
  const conditions: string[] = []
  const bindings: (string | number)[] = []

  if (search) {
    conditions.push('(email LIKE ? OR firstName LIKE ? OR lastName LIKE ?)')
    const pattern = `%${search}%`
    bindings.push(pattern, pattern, pattern)
  }
  if (tier) {
    conditions.push('tier = ?')
    bindings.push(tier)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?'
  bindings.push(limit, offset)

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<Customer>()
  return result.results
}

export async function getCustomerCount(db: D1Database): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM customers')
    .first<{ count: number }>()
  return result?.count ?? 0
}

export async function getProCustomerCount(db: D1Database): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM customers WHERE tier = 'pro'")
    .first<{ count: number }>()
  return result?.count ?? 0
}

export async function getVerifiedCount(db: D1Database): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM customers WHERE emailVerified = 1')
    .first<{ count: number }>()
  return result?.count ?? 0
}

export async function getRecentSignups(db: D1Database, days: number): Promise<number> {
  const result = await db
    .prepare(
      "SELECT COUNT(*) as count FROM customers WHERE createdAt >= datetime('now', '-' || ? || ' days')"
    )
    .bind(days)
    .first<{ count: number }>()
  return result?.count ?? 0
}
