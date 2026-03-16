# Marketing Site Auth, CLI Gating & Admin Dashboard — Implementation Plan

## Context
We have zero visibility into who uses our product. "Start for Free" just scrolls to CLI install commands — no account, no tracking. We need:
1. **Customer accounts** with signup/login on marketing site + CLI
2. **Email verification** before access
3. **CLI gated behind login** — every user must have an account
4. **Customer dashboard** showing tier, license key, CLI commands
5. **Admin analytics dashboard** for us as product owners — signups, conversions, revenue, customer table

## Key Decisions
- CLI requires account (no anonymous usage)
- Email verification required before dashboard/CLI access
- Extend existing license-server (Cloudflare Worker + D1) — no new infra
- JWT bearer tokens (not cookies) for static site auth
- Admin dashboard protected by separate admin secret

---

## Phase 1: License Server — Auth Primitives (4 new files, 2 modified)

### Step 1: Password hashing utility
**New file:** `license-server/src/lib/password.ts`

```typescript
// PBKDF2 via Web Crypto — matches apps/web/seed.js pattern
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }>
export async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean>
```

- Use `crypto.subtle.importKey('raw', ..., 'PBKDF2')` → `crypto.subtle.deriveBits()`
- 310,000 iterations, SHA-256, 256 bits (32 bytes)
- Salt: 16 random bytes via `crypto.getRandomValues(new Uint8Array(16))`
- Hex encoding for storage (same as `apps/web/seed.js`)
- Constant-time comparison for verify: compare all bytes, don't short-circuit

### Step 2: Customer JWT functions
**Modify:** `license-server/src/lib/keys.ts`

Add alongside existing `signLicenseJwt`/`verifyLicenseJwt`:

```typescript
export interface CustomerJwtPayload {
  sub: string        // customer.id
  email: string
  tier: string
  emailVerified: boolean
  iat: number
  exp: number        // 7 days from issuance
  iss: string        // 'lead-routing-auth' (NOT 'lead-routing-license-server')
}

export async function signCustomerJwt(
  payload: { sub: string; email: string; tier: string; emailVerified: boolean },
  privateKeyBase64: string
): Promise<string>

export async function verifyCustomerJwt(
  jwt: string,
  publicKeyBase64: string
): Promise<CustomerJwtPayload | null>
```

- Reuses existing `importPrivateKey()`, `importPublicKey()`, `base64urlEncode/Decode()`, `textToBase64url()` helpers
- `iss: 'lead-routing-auth'` differentiates from license JWTs (`iss: 'lead-routing-license-server'`)
- `verifyCustomerJwt` checks `iss === 'lead-routing-auth'` and `exp > now`

### Step 3: Auth middleware
**New file:** `license-server/src/lib/auth-middleware.ts`

```typescript
import { Context, Next } from 'hono'
import { verifyCustomerJwt } from './keys'

// Sets c.set('customerId'), c.set('customerEmail'), c.set('emailVerified')
export function authMiddleware(options?: { requireVerified?: boolean })
```

- Extracts `Authorization: Bearer <jwt>` header
- Calls `verifyCustomerJwt(jwt, c.env.ED25519_PUBLIC_KEY)`
- Returns `401 { error: 'unauthorized' }` if missing/invalid/expired
- If `requireVerified: true` and `emailVerified === false` → returns `403 { error: 'email_not_verified' }`
- Sets customer data on Hono context via `c.set()`

### Step 4: Customer DB helpers
**Modify:** `license-server/src/lib/db.ts`

Add new `Customer` interface and CRUD functions alongside existing `License` ones:

```typescript
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
  emailVerified: number  // 0 or 1 (SQLite)
  emailVerifyToken: string | null
  emailVerifyExpiry: string | null
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
}

export async function findCustomerByEmail(db: D1Database, email: string): Promise<Customer | null>
export async function findCustomerById(db: D1Database, id: string): Promise<Customer | null>
export async function createCustomer(db: D1Database, data: CreateCustomerData): Promise<void>
export async function updateCustomerTier(db: D1Database, email: string, tier: string, licenseId: string): Promise<void>
export async function updateCustomerLogin(db: D1Database, id: string): Promise<void>
export async function verifyCustomerEmail(db: D1Database, id: string): Promise<void>
export async function setEmailVerifyToken(db: D1Database, id: string, token: string, expiry: string): Promise<void>
export async function findCustomerByVerifyToken(db: D1Database, token: string): Promise<Customer | null>
// Admin queries
export async function getAllCustomers(db: D1Database, limit: number, offset: number): Promise<Customer[]>
export async function getCustomerCount(db: D1Database): Promise<number>
export async function getProCustomerCount(db: D1Database): Promise<number>
export async function getVerifiedCount(db: D1Database): Promise<number>
export async function getRecentSignups(db: D1Database, days: number): Promise<number>
```

SQL patterns follow existing style: `db.prepare('...').bind(...).first<T>()` / `.run()` / `.all()`

### Step 5: Email verification sender
**Modify:** `license-server/src/lib/email.ts`

Add alongside existing `sendLicenseKeyEmail`:

```typescript
export async function sendVerificationEmail(
  apiKey: string,
  to: string,
  firstName: string,
  token: string
): Promise<void>
```

- Same Resend API pattern as `sendLicenseKeyEmail` (POST to `https://api.resend.com/emails`)
- From: `Lead Routing <noreply@openedgeai.tech>`
- Subject: `Verify your email — Lead Routing`
- HTML template matching existing branded style (dark header, white body)
- Verification link: `https://openedgeai.tech/verify-email.html?token=${token}`
- Token: `crypto.randomUUID() + crypto.randomUUID()` (no hyphens), 24h expiry

### Step 6: Database migration
**Modify:** `license-server/schema.sql`

Append new table:

```sql
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
```

Deploy: `wrangler d1 execute lead-routing-licenses --remote --file=./schema.sql`

---

## Phase 2: License Server — API Routes (3 new files, 3 modified)

### Step 7: Auth routes
**New file:** `license-server/src/routes/auth.ts`

```typescript
const auth = new Hono<{ Bindings: Env }>()
```

| Method | Path | Auth | Body/Response |
|--------|------|------|---------------|
| `POST /signup` | Public | `{ firstName, lastName, email, password }` → `{ message: 'Verification email sent' }` |
| `POST /login` | Public | `{ email, password }` → `{ token, customer: { id, email, firstName, lastName, tier, emailVerified } }` |
| `GET /me` | Bearer | → `{ customer, license? }` (joins license data if Pro) |
| `POST /verify-email` | Public | `{ token }` → `{ verified: true }` |
| `POST /resend-verification` | Bearer | → `{ message: 'Sent' }` (rate limit: check emailVerifyExpiry > now - 60s) |

**Signup logic:**
1. Validate: email regex, password >= 8 chars, firstName + lastName required
2. `findCustomerByEmail` → 409 if exists
3. `hashPassword(password)` → `{ hash, salt }`
4. Generate verify token: `crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')`
5. Expiry: `new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()`
6. `createCustomer(db, { id: crypto.randomUUID(), email, firstName, lastName, passwordHash, passwordSalt, emailVerifyToken, emailVerifyExpiry })`
7. `sendVerificationEmail(apiKey, email, firstName, token)`
8. Return 201

**Login logic:**
1. `findCustomerByEmail` → 401 if not found
2. `verifyPassword(password, customer.passwordHash, customer.passwordSalt)` → 401 if false
3. `updateCustomerLogin(db, customer.id)`
4. Check if Pro: if `customer.licenseId`, fetch license for validUntil
5. `signCustomerJwt({ sub: customer.id, email, tier, emailVerified: !!customer.emailVerified })`
6. Return `{ token, customer: { ... } }`

**Verify-email logic:**
1. `findCustomerByVerifyToken(db, token)` → 400 if not found
2. Check `emailVerifyExpiry > now` → 400 if expired
3. `verifyCustomerEmail(db, customer.id)` (sets emailVerified=1, clears token)
4. Return `{ verified: true }`

**Me logic:**
1. Auth middleware (Bearer required)
2. `findCustomerById(db, c.get('customerId'))`
3. If `customer.licenseId` → `findLicenseByKey` to get license details
4. Return merged customer + license data

### Step 8: Account routes
**New file:** `license-server/src/routes/account.ts`

```typescript
const account = new Hono<{ Bindings: Env }>()
```

Both routes use `authMiddleware({ requireVerified: true })`.

| Method | Path | Description |
|--------|------|-------------|
| `POST /upgrade` | Creates Stripe Checkout session with customer email pre-filled, `success_url` → `dashboard.html?upgraded=true`, `cancel_url` → `dashboard.html`. Returns `{ url }`. Reuses same Stripe init pattern from `checkout.ts`. |
| `GET /billing-portal` | Creates Stripe Billing Portal session. Requires `customer.stripeCustomerId`. Returns `{ url }`. |

### Step 9: Admin routes
**New file:** `license-server/src/routes/admin.ts`

Protected by `ADMIN_SECRET` env var (simple bearer token, not customer JWT).

```typescript
// Middleware: check Authorization header === `Bearer ${c.env.ADMIN_SECRET}`
```

| Method | Path | Description |
|--------|------|-------------|
| `GET /customers` | Query params: `?limit=20&offset=0&search=&tier=`. Returns `{ customers: [...], total, proCount, verifiedCount }` |
| `GET /stats` | Returns `{ totalSignups, proCustomers, conversionRate, mrr, verifiedRate, recentSignups7d, recentSignups30d }` |
| `GET /activity` | Returns last 20 customer events (signups, verifications, upgrades) ordered by date |
| `GET /revenue` | Returns `{ arr, mrr, activeSubscriptions, churn90d, gracePeriodCount }` from licenses + customers tables |

### Step 10: Mount routes & update CORS
**Modify:** `license-server/src/index.ts`

```typescript
import auth from './routes/auth'
import account from './routes/account'
import admin from './routes/admin'

// Add to CORS origins:
origin: ['https://openedgeai.tech', 'https://www.openedgeai.tech', 'http://localhost:5500', 'http://127.0.0.1:5500']

// Mount routes:
app.route('/v1/auth', auth)
app.route('/v1/account', account)
app.route('/v1/admin', admin)
```

Add `ADMIN_SECRET` to the `Env` type.

### Step 11: Link license to customer in webhook
**Modify:** `license-server/src/routes/webhook.ts`

In `checkout.session.completed` handler, after `createLicense(...)` and before sending email:

```typescript
import { findCustomerByEmail, updateCustomerTier, createCustomer } from '../lib/db'
import { hashPassword } from '../lib/password'

// After license creation:
const customer = await findCustomerByEmail(c.env.DB, email)
if (customer) {
  await updateCustomerTier(c.env.DB, email, 'pro', licenseKey)
} else {
  // Customer bought without signing up — create account
  const tempPassword = crypto.randomUUID()
  const { hash, salt } = await hashPassword(tempPassword)
  await createCustomer(c.env.DB, {
    id: crypto.randomUUID(),
    email,
    firstName: session.customer_details?.name?.split(' ')[0] ?? 'Customer',
    lastName: session.customer_details?.name?.split(' ').slice(1).join(' ') ?? '',
    passwordHash: hash,
    passwordSalt: salt,
    tier: 'pro',
    emailVerified: 1,  // Stripe verified their email
    licenseId: licenseKey,
    stripeCustomerId: customerId,
  })
  // TODO: Send "set your password" email
}
```

### Step 12: Update checkout redirect URLs
**Modify:** `license-server/src/routes/checkout.ts`

```typescript
success_url: body.successUrl || 'https://openedgeai.tech/dashboard.html?upgraded=true'
cancel_url: body.cancelUrl || 'https://openedgeai.tech/dashboard.html'
```

### Step 13: Add ADMIN_SECRET to wrangler.toml
**Modify:** `license-server/wrangler.toml`

```toml
[vars]
ADMIN_SECRET = "..." # generate a random 64-char hex secret
```

---

## Phase 3: CLI — Account Gating (3 new files, 2 modified)

### Step 14: Auth utility for CLI
**New file:** `apps/cli/src/utils/auth.ts`

```typescript
import { LICENSE_API_URL } from './license.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface StoredCredentials {
  token: string
  customer: {
    id: string
    email: string
    firstName: string
    lastName: string
    tier: 'free' | 'pro'
    emailVerified: boolean
  }
  storedAt: string
}

const CRED_DIR = join(homedir(), '.lead-routing')
const CRED_FILE = join(CRED_DIR, 'credentials.json')

export function loadCredentials(): StoredCredentials | null
export function saveCredentials(creds: StoredCredentials): void
export function clearCredentials(): void

export async function requireAuth(): Promise<StoredCredentials>
// Loads credentials, calls GET /v1/auth/me to verify token still valid
// If expired/invalid → clears credentials, throws with "Please run `lead-routing login`"
// If emailVerified === false → throws with "Please verify your email first"
// Returns fresh customer data from /me response

export async function apiLogin(email: string, password: string): Promise<{ token: string; customer: any }>
// POST /v1/auth/login → returns { token, customer }

export async function apiSignup(data: { firstName: string; lastName: string; email: string; password: string }): Promise<void>
// POST /v1/auth/signup → returns { message }
```

- Uses `LICENSE_API_URL` from existing `license.ts` (same base URL)
- Credentials stored as JSON in `~/.lead-routing/credentials.json`
- `mkdirSync(CRED_DIR, { recursive: true })` for first use

### Step 15: Signup command
**New file:** `apps/cli/src/commands/signup.ts`

```typescript
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { apiSignup } from '../utils/auth.js'

export async function runSignup(): Promise<void>
```

Flow:
1. `p.intro(chalk.bgBlue(' lead-routing signup '))`
2. Prompt: firstName (`p.text`), lastName (`p.text`), email (`p.text`), password (`p.password`), confirmPassword (`p.password`)
3. Validate password match client-side
4. Spinner: "Creating account..."
5. Call `apiSignup({ firstName, lastName, email, password })`
6. On success: `p.note('Check your email for a verification link.\nAfter verifying, run: lead-routing login')`
7. On 409: "Email already registered. Try `lead-routing login`"
8. On error: Show error message

### Step 16: Login command
**New file:** `apps/cli/src/commands/login.ts`

```typescript
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { apiLogin, saveCredentials } from '../utils/auth.js'
import { formatTierBadge } from '../utils/license.js'

export async function runLogin(): Promise<void>
```

Flow:
1. `p.intro(chalk.bgBlue(' lead-routing login '))`
2. Prompt: email (`p.text`), password (`p.password`)
3. Spinner: "Authenticating..."
4. Call `apiLogin(email, password)`
5. If `customer.emailVerified === false` → show error: "Email not verified. Check inbox."
   - Offer to resend: `p.confirm({ message: 'Resend verification email?' })`
   - If yes: POST `/v1/auth/resend-verification` with Bearer token
6. If verified: `saveCredentials({ token, customer, storedAt: new Date().toISOString() })`
7. `p.log.success('Logged in as ' + customer.firstName + ' ' + customer.lastName + ' — ' + formatTierBadge(customer.tier))`
8. `p.note('Credentials saved to ~/.lead-routing/credentials.json')`

### Step 17: Gate init command behind login
**Modify:** `apps/cli/src/commands/init.ts`

At the top of `runInit()`, before the current Step 1 (license validation):

```typescript
import { requireAuth, type StoredCredentials } from '../utils/auth.js'

// NEW: Auth check (replaces validateLicenseStep)
let auth: StoredCredentials
try {
  auth = await requireAuth()
} catch (err) {
  p.log.error(err instanceof Error ? err.message : 'Authentication required')
  p.note(
    'Run one of the following:\n\n' +
    '  lead-routing signup   Create a new account\n' +
    '  lead-routing login    Log in to existing account',
    'Account Required'
  )
  process.exit(1)
}

p.log.success(`Logged in as ${auth.customer.firstName} ${auth.customer.lastName} — ${formatTierBadge(auth.customer.tier)}`)

// Replace old licenseResult with auth-derived data:
const licenseResult = { tier: auth.customer.tier, key: undefined as string | undefined }
// If Pro, fetch license key from /me response (it's included in requireAuth)
```

Remove the `validateLicenseStep()` call (line ~129 in current init.ts). The `licenseResult` variable still flows to `generateFiles()` unchanged.

### Step 18: Register new commands
**Modify:** `apps/cli/src/index.ts`

```typescript
import { runSignup } from './commands/signup.js'
import { runLogin } from './commands/login.js'

program
  .command('signup')
  .description('Create a new Lead Routing account')
  .action(runSignup)

program
  .command('login')
  .description('Log in to your Lead Routing account')
  .action(runLogin)
```

---

## Phase 4: Marketing Site — Auth Pages (5 new files, 1 modified)

### Step 19: Extract shared CSS
**New file:** `site/shared.css`

Extract from `site/index.html`:
- CSS reset (`*, *::before, *::after`)
- All 5 theme definitions (`:root`, `[data-theme="..."]`)
- Body styles, noise overlay, font imports
- Nav styles (`.logo`, `.logo-icon`, `.nav-links`, `.btn-nav`)
- Button styles (`.btn-primary`, `.btn-secondary`)
- Utility classes (`.container`, `.sr-only`)
- Animation keyframes (`fadeInUp`, `orbFloat`, `blink`)
- Add new form input styles, auth card styles

Both `index.html` and all new pages `<link rel="stylesheet" href="/shared.css">`.

### Step 20: Signup page
**New file:** `site/signup.html`

Based on prototype. Key JS logic:
```javascript
const API = 'https://lead-routing-license.artyagi2011.workers.dev'

form.onsubmit = async (e) => {
  e.preventDefault()
  const res = await fetch(`${API}/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName, lastName, email, password })
  })
  if (res.ok) {
    // Show "check your email" message
    // If ?plan=pro, store in localStorage for after verification
  } else if (res.status === 409) {
    showError('Email already registered')
  }
}
```

### Step 21: Email verification page
**New file:** `site/verify-email.html`

```javascript
const token = new URLSearchParams(location.search).get('token')
const res = await fetch(`${API}/v1/auth/verify-email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token })
})
// Show success with confetti or error with resend option
```

### Step 22: Login page
**New file:** `site/login.html`

```javascript
form.onsubmit = async (e) => {
  e.preventDefault()
  const res = await fetch(`${API}/v1/auth/login`, { ... })
  const { token, customer } = await res.json()
  localStorage.setItem('lr_token', token)
  localStorage.setItem('lr_customer', JSON.stringify(customer))
  if (!customer.emailVerified) {
    showVerificationBanner()
  } else {
    location.href = '/dashboard.html'
  }
}
```

### Step 23: Customer dashboard page
**New file:** `site/dashboard.html`

Based on prototype (free + pro views in one page). Key JS:
```javascript
const token = localStorage.getItem('lr_token')
if (!token) location.href = '/login.html'

const res = await fetch(`${API}/v1/auth/me`, {
  headers: { 'Authorization': `Bearer ${token}` }
})
if (res.status === 401) { localStorage.clear(); location.href = '/login.html' }

const { customer, license } = await res.json()
// Render free or pro view based on customer.tier
// Upgrade button: POST /v1/account/upgrade → redirect to Stripe
// Pro: show license key, manage billing button
```

### Step 24: Admin dashboard page
**New file:** `site/admin.html`

Password-protected (prompt for admin secret on load, store in `sessionStorage`).

```javascript
const secret = sessionStorage.getItem('admin_secret') || prompt('Admin secret:')
const headers = { 'Authorization': `Bearer ${secret}` }

// Fetch all data in parallel:
const [stats, customers, revenue] = await Promise.all([
  fetch(`${API}/v1/admin/stats`, { headers }).then(r => r.json()),
  fetch(`${API}/v1/admin/customers?limit=20`, { headers }).then(r => r.json()),
  fetch(`${API}/v1/admin/revenue`, { headers }).then(r => r.json()),
])
```

Features (as shown in prototype):
- 5 KPI cards (total signups, pro customers, conversion rate, MRR, verified rate)
- Signups over time line chart (SVG, dynamically rendered from `/admin/stats` time series)
- Conversion funnel (visited → signed up → verified → deployed → upgraded)
- Revenue breakdown (ARR, MRR, churn, grace period)
- Recent activity feed
- Searchable customer table with pagination + CSV export
- Auto-refresh every 60s

### Step 25: Update marketing site CTAs
**Modify:** `site/index.html`

```
Line 1859: Nav "Get Started" → href="/signup.html"
Line 1880: Hero "Get Started Free" → href="/signup.html"
Line 2355: Pricing "Start Free" → href="/signup.html"
Line 2370: Pricing "Get Started" (Pro) → href="/signup.html?plan=pro"
Line 2388: CTA "Deploy Now — Free" → href="/signup.html"
```

Add "Login" link in nav (before "Get Started"):
```html
<li><a href="/login.html">Login</a></li>
```

---

## Implementation Order

| # | File | Type | Description |
|---|------|------|-------------|
| 1 | `license-server/src/lib/password.ts` | New | PBKDF2 hash/verify |
| 2 | `license-server/schema.sql` | Modify | Add customers table |
| 3 | `license-server/src/lib/db.ts` | Modify | Customer CRUD + admin queries |
| 4 | `license-server/src/lib/keys.ts` | Modify | Customer JWT sign/verify |
| 5 | `license-server/src/lib/auth-middleware.ts` | New | Bearer token middleware |
| 6 | `license-server/src/lib/email.ts` | Modify | Add verification email |
| 7 | `license-server/src/routes/auth.ts` | New | signup, login, me, verify, resend |
| 8 | `license-server/src/routes/account.ts` | New | upgrade, billing portal |
| 9 | `license-server/src/routes/admin.ts` | New | customers, stats, activity, revenue |
| 10 | `license-server/src/index.ts` | Modify | Mount routes, CORS, Env type |
| 11 | `license-server/src/routes/webhook.ts` | Modify | Link license → customer |
| 12 | `license-server/src/routes/checkout.ts` | Modify | Update redirect URLs |
| 13 | `license-server/wrangler.toml` | Modify | Add ADMIN_SECRET |
| 14 | `apps/cli/src/utils/auth.ts` | New | Credential storage + API calls |
| 15 | `apps/cli/src/commands/signup.ts` | New | Signup command |
| 16 | `apps/cli/src/commands/login.ts` | New | Login command |
| 17 | `apps/cli/src/commands/init.ts` | Modify | Auth gate at start |
| 18 | `apps/cli/src/index.ts` | Modify | Register signup + login commands |
| 19 | `site/shared.css` | New | Extracted shared styles |
| 20 | `site/signup.html` | New | Signup page |
| 21 | `site/verify-email.html` | New | Email verification page |
| 22 | `site/login.html` | New | Login page |
| 23 | `site/dashboard.html` | New | Customer dashboard |
| 24 | `site/admin.html` | New | Admin analytics dashboard |
| 25 | `site/index.html` | Modify | Rewire CTAs + add Login nav link |

**Summary: 14 new files, 11 modified files**

---

## Verification Checklist

### License Server API
1. `POST /v1/auth/signup` → 201, customer in D1 with `emailVerified: 0`, verification email sent
2. `POST /v1/auth/verify-email` → customer `emailVerified: 1`, token cleared
3. `POST /v1/auth/login` → JWT returned with correct claims
4. `GET /v1/auth/me` with Bearer → full customer profile
5. `GET /v1/auth/me` with expired JWT → 401
6. `POST /v1/account/upgrade` → Stripe Checkout URL returned
7. Stripe test checkout (4242...) → webhook → license created + linked to customer → tier = pro
8. `GET /v1/admin/stats` with admin secret → KPI data
9. `GET /v1/admin/customers` → paginated customer list

### CLI
10. `npx @lead-routing/cli signup` → account created, "check your email" message
11. `npx @lead-routing/cli login` (unverified) → "verify email first" error
12. `npx @lead-routing/cli login` (verified) → credentials saved to `~/.lead-routing/credentials.json`
13. `npx @lead-routing/cli init` (not logged in) → "account required" error with instructions
14. `npx @lead-routing/cli init` (logged in, free) → proceeds with free tier
15. `npx @lead-routing/cli init` (logged in, pro) → proceeds with pro tier, license auto-injected

### Marketing Site
16. All "Start Free" / "Get Started" buttons → `/signup.html`
17. Signup → verification email → verify page → login → dashboard
18. Free dashboard shows upgrade CTA, CLI commands
19. Pro dashboard shows license key (reveal/copy), expiration, billing
20. Admin dashboard shows all KPIs, charts, customer table, CSV export

### D1 Reporting
21. `wrangler d1 execute lead-routing-licenses --remote --command "SELECT COUNT(*) FROM customers"` → total signups
22. `wrangler d1 execute lead-routing-licenses --remote --command "SELECT tier, COUNT(*) FROM customers GROUP BY tier"` → tier breakdown
