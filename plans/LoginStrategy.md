# Login Strategy — Email/Password + Admin-Provisioned Orgs

## Why This Change
The original flow auto-created orgs on first Salesforce OAuth login. The new flow separates authentication from CRM connection:
- Admin provisions the org and sends an invite
- User registers with email + password
- After login, user connects Salesforce in onboarding

## New Flow
```
Admin: POST /api/admin/orgs (email, entityName, plan)
  → generates invite token → email with /register?token=...
User: /register?token=... → sets name + password → session created
User: /login (email + password)
Onboarding: "Connect Salesforce" button → /api/auth/sfdc/login → OAuth → stores tokens on org
```

## Implementation Waves

### Wave 1 — Foundation (sequential, everything depends on this)
- [x] **Phase 1**: DB schema — `AppUser` model, `Invite` model, SFDC fields optional on `Organization`

### Wave 2 — Utilities (parallel, no dependencies between them)
- [x] **Phase 2**: `SessionData` shape → `{ orgId, appUserId, userEmail, userName, role }`
- [x] **Phase 4**: `hashPassword` + `verifyPassword` added to `lib/crypto.ts`

### Wave 3 — Auth + UI + Admin (parallel after Wave 2)
- [x] **Phase 3**: Auth API routes
  - `POST /api/auth/login` (email/password)
  - `GET + POST /api/auth/register` (invite token flow)
  - `GET /api/auth/sfdc/login` (SFDC OAuth redirect — moved)
  - `GET /api/auth/sfdc/callback` (CRM connect — modified)
- [x] **Phase 5**: Pages
  - `app/(auth)/login/page.tsx` → email/password form
  - `app/(auth)/register/page.tsx` → new registration page
- [x] **Phase 6**: `proxy.ts` — add `/register` to public paths, update session field
- [x] **Phase 7**: Admin panel org creation — remove SFDC fields, generate invite token, send registration link

### Wave 4 — Onboarding (after Wave 3)
- [x] **Phase 8**: Dashboard onboarding step 1 → real "Connect Salesforce" check

## Key Models

### AppUser (new)
| Field | Type | Notes |
|---|---|---|
| id | cuid | PK |
| orgId | String | FK → Organization |
| email | String | unique per org |
| name | String | |
| passwordHash | String | PBKDF2: `salt:hash` |
| role | String | ADMIN \| MEMBER |
| isActive | Boolean | default true |

### Invite (new)
| Field | Type | Notes |
|---|---|---|
| id | cuid | PK |
| orgId | String | FK → Organization |
| email | String | |
| token | String | unique, 48-char hex |
| expiresAt | DateTime | 72 hours from creation |
| acceptedAt | DateTime? | null until used |

### Organization (changed)
- `sfdcOrgId` — `String? @unique` (was required)
- `sfdcInstanceUrl` — `String?` (was required)
- `oauthAccessToken` — `String?` (was required)
- `oauthRefreshToken` — `String?` (was required)

## Files Changed
| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | AppUser + Invite models; SFDC fields optional |
| `apps/web/lib/session.ts` | New SessionData shape |
| `apps/web/lib/crypto.ts` | hashPassword + verifyPassword |
| `apps/web/app/api/auth/login/route.ts` | Rewritten as POST email/pw |
| `apps/web/app/api/auth/register/route.ts` | New — GET+POST invite flow |
| `apps/web/app/api/auth/sfdc/login/route.ts` | Moved from /api/auth/login |
| `apps/web/app/api/auth/sfdc/callback/route.ts` | Moved + modified — updates existing org |
| `apps/web/app/(auth)/login/page.tsx` | Email/password form |
| `apps/web/app/(auth)/register/page.tsx` | New registration page |
| `apps/web/proxy.ts` | /register public; session field update |
| `apps/web/app/api/admin/orgs/route.ts` | Invite token generation + registration link email |
| `apps/web/app/(admin)/admin/orgs/page.tsx` | Remove SFDC fields from dialog |
| `apps/web/app/(dashboard)/dashboard/page.tsx` | Step 1 = real CRM connect check |
| `apps/web/app/api/onboarding/status/route.ts` | Step 1 done = sfdcOrgId != null |
