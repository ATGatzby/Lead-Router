# Phase 1 — Project Scaffold + Auth

**Duration:** Week 1
**Status:** ⬜ Not Started
**Depends on:** Nothing — this is the foundation

---

## Goal
Stand up the full monorepo structure, database schema, and Salesforce OAuth authentication so every subsequent phase has a working foundation to build on.

---

## Deliverables
- [ ] Turborepo monorepo with `apps/web`, `apps/engine`, `packages/db`, `packages/sfdc`
- [ ] PostgreSQL schema (all core tables) via Prisma
- [ ] Salesforce OAuth 2.0 login flow (Connected App → callback → session)
- [ ] Multi-tenant org isolation middleware
- [ ] Shell web app layout with sidebar navigation
- [ ] Environment config pattern (no hardcoded values)

---

## Monorepo Structure

```
lead-routing/
├── apps/
│   ├── web/                    # Next.js 14 web app (Config UI)
│   │   ├── app/
│   │   │   ├── (auth)/         # Login, OAuth callback
│   │   │   ├── (dashboard)/    # Protected routes
│   │   │   │   ├── license-users/
│   │   │   │   ├── round-robins/
│   │   │   │   ├── routing-rules/
│   │   │   │   └── history/
│   │   │   └── api/            # API routes
│   │   ├── components/
│   │   │   ├── ui/             # shadcn/ui components
│   │   │   ├── layout/         # Sidebar, header, shell
│   │   │   └── condition-builder/ # Phase 4
│   │   └── lib/
│   │       ├── auth.ts         # Session helpers
│   │       └── api-client.ts   # Typed fetch wrapper
│   │
│   └── engine/                 # Fastify routing engine
│       ├── src/
│       │   ├── server.ts       # Fastify server entry
│       │   ├── routes/
│       │   │   └── route.ts    # POST /route webhook endpoint
│       │   ├── evaluator.ts    # Rule condition evaluation (Phase 5)
│       │   ├── round-robin.ts  # Redis atomic pointer (Phase 5)
│       │   └── queue.ts        # BullMQ retry/DLQ (Phase 5)
│       └── package.json
│
├── packages/
│   ├── db/                     # Prisma schema + client
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── src/
│   │       └── index.ts        # Re-exports PrismaClient
│   │
│   └── sfdc/                   # jsforce wrapper utilities
│       └── src/
│           ├── client.ts       # OAuth client + token refresh
│           ├── users.ts        # User sync queries
│           ├── schema.ts       # describeSObject for field sync
│           └── queues.ts       # SFDC Queue sync
│
├── sfdc-package/               # Salesforce Managed Package (Phase 7)
│   └── force-app/
│       └── main/default/
│           ├── triggers/
│           └── lwc/
│
├── turbo.json
└── package.json
```

---

## Prisma Schema (All Tables)

```prisma
// packages/db/prisma/schema.prisma

model Organization {
  id                  String   @id @default(cuid())
  sfdcOrgId           String   @unique
  sfdcInstanceUrl     String
  oauthAccessToken    String
  oauthRefreshToken   String
  seatsPurchased      Int      @default(5)
  seatsUsed           Int      @default(0)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  users               User[]
  teams               RoundRobinTeam[]
  routingRules        RoutingRule[]
  routingLogs         RoutingLog[]
  auditLogs           AuditLog[]
  sfdc_queues         SfdcQueue[]
  fieldSchemas        FieldSchema[]
}

model User {
  id             String   @id @default(cuid())
  orgId          String
  sfdcUserId     String
  name           String
  email          String
  role           String?
  profile        String?
  department     String?
  isLicensed     Boolean  @default(false)
  isActive       Boolean  @default(true)
  lastRoutedAt   DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  org            Organization  @relation(fields: [orgId], references: [id])
  teamMemberships TeamMember[]

  @@unique([orgId, sfdcUserId])
}

model RoundRobinTeam {
  id           String   @id @default(cuid())
  orgId        String
  name         String
  description  String?
  pointerIndex Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  org          Organization @relation(fields: [orgId], references: [id])
  members      TeamMember[]
  routingRules RoutingRule[]
}

model TeamMember {
  id              String            @id @default(cuid())
  teamId          String
  userId          String
  status          TeamMemberStatus  @default(ACTIVE)
  weight          Int               @default(1)
  assignmentCount Int               @default(0)
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  team            RoundRobinTeam    @relation(fields: [teamId], references: [id])
  user            User              @relation(fields: [userId], references: [id])

  @@unique([teamId, userId])
}

enum TeamMemberStatus {
  ACTIVE
  PAUSED
}

model RoutingRule {
  id             String           @id @default(cuid())
  orgId          String
  objectType     SfdcObjectType
  triggerEvent   TriggerEvent
  name           String
  priority       Int
  status         RuleStatus       @default(ACTIVE)
  assignmentType AssignmentType
  assigneeUserId String?          // Individual user (User.id)
  assigneeTeamId String?          // Round Robin team (RoundRobinTeam.id)
  assigneeQueueId String?         // SFDC Queue (SfdcQueue.id)
  isDryRun       Boolean          @default(false)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  org            Organization     @relation(fields: [orgId], references: [id])
  team           RoundRobinTeam?  @relation(fields: [assigneeTeamId], references: [id])
  conditions     RuleCondition[]
}

enum SfdcObjectType { LEAD CONTACT ACCOUNT }
enum TriggerEvent   { INSERT UPDATE BOTH }
enum RuleStatus     { ACTIVE INACTIVE }
enum AssignmentType { USER ROUND_ROBIN QUEUE }

model RuleCondition {
  id          String   @id @default(cuid())
  ruleId      String
  groupId     String   // conditions in same group share AND/OR logic
  fieldName   String
  operator    String
  value       String?
  conjunction String   @default("AND") // AND | OR
  sortOrder   Int      @default(0)

  rule        RoutingRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)
}

model RoutingLog {
  id            String        @id @default(cuid())
  orgId         String
  sfdcRecordId  String
  objectType    SfdcObjectType
  eventType     TriggerEvent
  ruleId        String?
  ruleName      String?
  assigneeId    String?
  assigneeName  String?
  assignmentType AssignmentType?
  status        RoutingStatus
  errorMessage  String?
  retryCount    Int           @default(0)
  createdAt     DateTime      @default(now())

  org           Organization  @relation(fields: [orgId], references: [id])
}

enum RoutingStatus { SUCCESS FAILED UNMATCHED RETRY }

model AuditLog {
  id          String   @id @default(cuid())
  orgId       String
  actorId     String
  actorName   String
  action      String
  entityType  String
  entityId    String
  beforeState Json?
  afterState  Json?
  createdAt   DateTime @default(now())

  org         Organization @relation(fields: [orgId], references: [id])
}

model SfdcQueue {
  id           String   @id @default(cuid())
  orgId        String
  sfdcQueueId  String
  name         String
  syncedAt     DateTime @default(now())

  org          Organization @relation(fields: [orgId], references: [id])
  routingRules RoutingRule[]

  @@unique([orgId, sfdcQueueId])
}

model FieldSchema {
  id             String         @id @default(cuid())
  orgId          String
  objectType     SfdcObjectType
  fieldApiName   String
  fieldLabel     String
  fieldType      String
  picklistValues Json?          // for picklist fields
  syncedAt       DateTime       @default(now())

  org            Organization   @relation(fields: [orgId], references: [id])

  @@unique([orgId, objectType, fieldApiName])
}
```

---

## Salesforce OAuth 2.0 Flow

```
User visits /login
    │
    ▼
Redirect to SFDC OAuth authorize URL
    https://{instance}.salesforce.com/services/oauth2/authorize
    ?response_type=code
    &client_id={SFDC_CLIENT_ID}
    &redirect_uri={APP_URL}/api/auth/callback
    │
    ▼ (user approves in SFDC)
SFDC redirects to /api/auth/callback?code=xxx
    │
    ▼
Exchange code for access_token + refresh_token
    POST https://{instance}.salesforce.com/services/oauth2/token
    │
    ▼
Store tokens in Organization table
Create session (JWT or iron-session)
    │
    ▼
Redirect to /dashboard
```

**Key files:**
- `apps/web/app/api/auth/login/route.ts` — redirects to SFDC OAuth URL
- `apps/web/app/api/auth/callback/route.ts` — exchanges code, stores tokens, creates session
- `apps/web/lib/auth.ts` — session helpers (`getSession`, `requireAuth`)
- `packages/sfdc/src/client.ts` — jsforce Connection with auto token refresh

---

## Multi-Tenant Middleware

Every API route must scope queries to the authenticated org:

```typescript
// apps/web/middleware.ts
// Validate session on all /api/* and /(dashboard)/* routes
// Attach orgId to request headers for downstream use

// Every DB query pattern:
const rules = await prisma.routingRule.findMany({
  where: { orgId: session.orgId }  // ALWAYS scope by orgId
})
```

---

## Shell Layout (Sidebar Navigation)

```
┌──────────────────────────────────────────────────┐
│  ◈ Lead Router          [Org Name]  [Avatar]      │
├─────────────────┬────────────────────────────────-┤
│                 │                                  │
│  Setup          │                                  │
│  ▸ License Users│         Main Content             │
│  ▸ Round Robins │                                  │
│                 │                                  │
│  Routing        │                                  │
│  ▸ Rules        │                                  │
│  ▸ History      │                                  │
│                 │                                  │
│  Settings       │                                  │
│  ▸ Connection   │                                  │
│  ▸ Billing      │                                  │
│                 │                                  │
└─────────────────┴──────────────────────────────────┘
```

---

## Environment Variables

```env
# apps/web/.env.local
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
SFDC_CLIENT_ID=...
SFDC_CLIENT_SECRET=...
APP_URL=http://localhost:3000
SESSION_SECRET=...
ENGINE_URL=http://localhost:3001
ENGINE_WEBHOOK_SECRET=...
```

---

## Verification Checklist
- [ ] `pnpm dev` starts both `web` (port 3000) and `engine` (port 3001)
- [ ] Visiting `/login` redirects to Salesforce login page
- [ ] After SFDC OAuth approval, user lands on `/dashboard`
- [ ] Session persists on page refresh
- [ ] `/api/auth/me` returns current org and user
- [ ] Database tables created via `prisma db push`
- [ ] Unauthorized requests to `/api/*` return 401
