CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  jwt TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'pro',
  stripeCustomerId TEXT,
  stripeSubscriptionId TEXT,
  validUntil TEXT NOT NULL,
  graceUntil TEXT,
  serverFingerprint TEXT,
  lastHeartbeat TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_licenses_key ON licenses(key);
CREATE INDEX idx_licenses_email ON licenses(email);
CREATE INDEX idx_licenses_stripe ON licenses(stripeSubscriptionId);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  passwordSalt TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  stripeCustomerId TEXT,
  licenseId TEXT,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  emailVerifyToken TEXT,
  emailVerifyExpiry TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  lastLoginAt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_stripe ON customers(stripeCustomerId);
CREATE INDEX IF NOT EXISTS idx_customers_verify_token ON customers(emailVerifyToken);
