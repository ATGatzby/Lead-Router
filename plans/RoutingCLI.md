# Plan: Lead Routing CLI (`apps/cli`)

## Context

The project is being pivoted from a pure cloud SaaS to a **self-hosted product distributed via CLI**. Customers run `npx @lead-routing/cli init` on their server; the CLI walks them through configuration and deploys the full stack (web app, routing engine, PostgreSQL, Redis) using Docker Compose. Pre-built images are pulled from `ghcr.io/lead-routing/`.

The existing `apps/web`, `apps/engine`, `packages/db`, and `packages/sfdc` are unchanged — the CLI is a new orchestration layer on top of them.

---

## New Package: `apps/cli`

### Package Identity
- **Name:** `@lead-routing/cli`
- **Bin entry:** `lead-routing` → `./dist/index.js`
- **npx usage:** `npx @lead-routing/cli init`
- **Build tool:** `tsup` (single-file CJS bundle, shebang injected)

### Key Dependencies
| Package | Purpose |
|---|---|
| `@clack/prompts` ^0.9 | Interactive wizard prompts with built-in spinners |
| `commander` ^13 | Command/subcommand routing |
| `execa` ^9 | Shell command execution (docker, prisma) |
| `chalk` ^5 | Terminal colours |

---

## Directory Structure

```
apps/cli/
├── src/
│   ├── index.ts                    # Commander root + version banner
│   ├── commands/
│   │   ├── init.ts                 # `lead-routing init` — full setup wizard
│   │   ├── deploy.ts               # `lead-routing deploy` — update/redeploy
│   │   ├── doctor.ts               # `lead-routing doctor` — health checks
│   │   ├── logs.ts                 # `lead-routing logs [web|engine|db|redis]`
│   │   └── status.ts               # `lead-routing status` — container table
│   ├── steps/                      # Sequential steps called by `init`
│   │   ├── prerequisites.ts        # Check docker, docker compose, node version
│   │   ├── collect-config.ts       # @clack/prompts wizard → returns Config object
│   │   ├── generate-files.ts       # Write .env.web, .env.engine, docker-compose.yml
│   │   ├── start-services.ts       # `docker compose pull && docker compose up -d`
│   │   ├── run-migrations.ts       # `docker compose exec web npx prisma migrate deploy`
│   │   └── verify-health.ts        # Poll /api/health (web) and /health (engine)
│   ├── templates/
│   │   ├── docker-compose.ts       # Returns docker-compose.yml string from Config
│   │   ├── env-web.ts              # Returns .env.web content string
│   │   └── env-engine.ts           # Returns .env.engine content string
│   └── utils/
│       ├── exec.ts                 # execa wrapper with clack spinner integration
│       ├── config.ts               # Read/write lead-routing.json (persists install config)
│       └── crypto.ts               # generateSecret() — crypto.randomBytes(32).toString('hex')
├── package.json
└── tsconfig.json
```

---

## The `init` Wizard — Step by Step

```
$ lead-routing init

  ╔══════════════════════════════════════╗
  ║   Lead Routing — Self-Hosted Setup   ║
  ╚══════════════════════════════════════╝

  Step 1/6  Checking prerequisites...
  Step 2/6  Configuration
  Step 3/6  Generating config files
  Step 4/6  Starting services
  Step 5/6  Running database migrations
  Step 6/6  Verifying health

  ✔  Setup complete!  https://routing.acme.com
```

### Step 1 — Prerequisites
- `docker --version` → fail if < Docker 24
- `docker compose version` → fail if missing
- Node.js ≥ 20 (already satisfied since CLI runs on Node)

### Step 2 — Config Collection (`@clack/prompts`)
Groups of prompts:

**App**
- `APP_URL` — Public URL (e.g. `https://routing.acme.com`)

**Salesforce**
- `SFDC_CLIENT_ID` — Connected App Consumer Key
- `SFDC_CLIENT_SECRET` — Consumer Secret (masked input)
- `SFDC_LOGIN_URL` — `https://login.salesforce.com` or sandbox

**Database**
- Choice: Docker-managed (default) or BYO PostgreSQL URL
- If BYO: prompt for `DATABASE_URL`

**Redis**
- Choice: Docker-managed (default) or BYO Redis URL
- If BYO: prompt for `REDIS_URL`

**Admin Account**
- `ADMIN_EMAIL` — first AppUser email
- `ADMIN_PASSWORD` — masked, min 8 chars

**Optional**
- `RESEND_API_KEY` — for email invites (skip-able)

### Step 3 — Generate Files
Written to `cwd/lead-routing/`:
- `docker-compose.yml` — all services
- `.env.web` — web app env vars (auto-generates `SESSION_SECRET`, `ENGINE_WEBHOOK_SECRET`)
- `.env.engine` — engine env vars (shares webhook secret with web)
- `lead-routing.json` — persisted config for `deploy`/`doctor`/`logs` to read

### Step 4 — Start Services
```bash
docker compose pull
docker compose up -d
```
Wait until postgres is accepting connections (retry loop, 30s timeout).

### Step 5 — Migrations
```bash
docker compose exec web npx prisma migrate deploy
```
Then seed the admin AppUser via a one-shot `prisma.$executeRaw` command run in the same exec.

### Step 6 — Verify Health
Poll `GET {APP_URL}/api/health` and `GET {ENGINE_URL}/health` with retries.
Print ✔ / ✗ for each service.

---

## Docker Compose Template

Services generated based on user config choices:

```yaml
services:
  postgres:            # only if Docker-managed DB chosen
    image: postgres:16-alpine
    environment: { POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD }
    volumes: [postgres_data:/var/lib/postgresql/data]

  redis:               # only if Docker-managed Redis chosen
    image: redis:7-alpine
    volumes: [redis_data:/data]

  web:
    image: ghcr.io/lead-routing/web:latest
    ports: ["3000:3000"]
    env_file: .env.web
    depends_on: [postgres, redis]   # only if Docker-managed

  engine:
    image: ghcr.io/lead-routing/engine:latest
    ports: ["3001:3001"]
    env_file: .env.engine
    depends_on: [postgres, redis]   # only if Docker-managed
```

---

## Other Commands

### `lead-routing deploy`
1. Read `lead-routing.json` from cwd
2. `docker compose pull`
3. `docker compose up -d`
4. `docker compose exec web npx prisma migrate deploy`
5. Print success

### `lead-routing doctor`
Runs checks, prints pass/fail table:
| Check | Status |
|---|---|
| Docker daemon running | ✔ / ✗ |
| `web` container up | ✔ / ✗ |
| `engine` container up | ✔ / ✗ |
| `postgres` container up | ✔ / ✗ (if managed) |
| `redis` container up | ✔ / ✗ (if managed) |
| Web health endpoint | ✔ / ✗ |
| Engine health endpoint | ✔ / ✗ |

### `lead-routing logs [service]`
Runs `docker compose logs -f [service]`. Default service: `engine`.
Valid services: `web`, `engine`, `postgres`, `redis`.

### `lead-routing status`
Runs `docker compose ps` and prints the output (passes through).

---

## Config Persistence (`lead-routing.json`)

Saved in `cwd/lead-routing/lead-routing.json`:
```json
{
  "appUrl": "https://routing.acme.com",
  "engineUrl": "http://localhost:3001",
  "dockerManaged": { "db": true, "redis": true },
  "installedAt": "2026-02-27T00:00:00Z",
  "version": "0.1.0"
}
```
This file is read by `deploy`, `doctor`, `logs`, and `status` so they know the install location and which services to check.

---

## Files to Create

| File | Description |
|---|---|
| `apps/cli/package.json` | Package manifest with bin entry, deps, tsup build |
| `apps/cli/tsconfig.json` | Extends `../../tsconfig.base.json`, targets NodeNext |
| `apps/cli/src/index.ts` | Commander root, version, registers all commands |
| `apps/cli/src/commands/init.ts` | Orchestrates all 6 init steps |
| `apps/cli/src/commands/deploy.ts` | Pull + restart + migrate |
| `apps/cli/src/commands/doctor.ts` | Health check table |
| `apps/cli/src/commands/logs.ts` | docker compose logs passthrough |
| `apps/cli/src/commands/status.ts` | docker compose ps passthrough |
| `apps/cli/src/steps/prerequisites.ts` | Docker version checks |
| `apps/cli/src/steps/collect-config.ts` | Full @clack/prompts wizard |
| `apps/cli/src/steps/generate-files.ts` | Write env + compose files |
| `apps/cli/src/steps/start-services.ts` | docker compose pull + up |
| `apps/cli/src/steps/run-migrations.ts` | prisma migrate + admin seed |
| `apps/cli/src/steps/verify-health.ts` | Poll health endpoints |
| `apps/cli/src/templates/docker-compose.ts` | Compose YAML generator function |
| `apps/cli/src/templates/env-web.ts` | .env.web generator function |
| `apps/cli/src/templates/env-engine.ts` | .env.engine generator function |
| `apps/cli/src/utils/exec.ts` | execa + clack spinner wrapper |
| `apps/cli/src/utils/config.ts` | lead-routing.json read/write |
| `apps/cli/src/utils/crypto.ts` | Random secret generation |

## Files to Modify

| File | Change |
|---|---|
| `turbo.json` | Add `"build"` output for `apps/cli` (dist/**) |
| `Technical-Implementation.md` | Add §CLI section, update architecture diagram, file table |
