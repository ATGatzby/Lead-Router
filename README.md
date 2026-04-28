# Lead Routing

> Self-hosted, Salesforce-native lead routing engine with a visual Route Builder, AI-powered rule generation, round-robin assignment, and a Next.js management UI — deployed to your own server in minutes via a single CLI command.

[![npm version](https://img.shields.io/npm/v/@lead-routing/cli)](https://www.npmjs.com/package/@lead-routing/cli)
[![CI](https://github.com/ATGatzby/Lead-Router/actions/workflows/test.yml/badge.svg)](https://github.com/ATGatzby/Lead-Router/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What It Does

When a Lead, Contact, or Account is created or updated in Salesforce, Lead Routing automatically assigns the record's `OwnerId` to the right sales rep based on rules you configure in a visual builder — no code required.

**Key features:**
- **Visual Route Builder** — multi-step branches with Trigger → Match → Filter → Assign → Update Field → Create Task pipeline
- **AI Rule Generator** — describe routing rules in natural language, AI generates the configuration (supports Claude, OpenAI, Gemini)
- **Scheduled Routes** — bulk search and route records on a cron schedule (daily, weekly, monthly)
- **Duplicate matching** — configurable lead-to-contact, lead-to-account, and contact-to-account match actions with fuzzy and AI-powered matching
- **17 condition operators** — equals, contains, greater than, date ranges, regex, and more
- **Round-robin assignment** — equal or weighted distribution across teams with per-member pause/resume
- **Salesforce queue support** — assign to queues or individual users
- **Trigger conditions** — pre-filter which records even reach the routing engine using Apex-side criteria evaluation
- **Dry-run mode** — test rules without making live assignments
- **Full routing history** — routing logs with decision traces, record journey visualization, and daily analytics
- **License management** — license users by individual, role, profile, queue, or custom field
- **API tokens** — programmatic access via Bearer token auth
- **MCP Server** — manage rules, teams, and routing via Claude Desktop or any MCP client
- **HMAC-signed webhooks** for secure Salesforce → engine communication
- **100% self-hosted** — your data never leaves your server

---

## How It Works

```
Salesforce Org
  └─ Apex trigger fires on Lead/Contact/Account insert or update
     └─ CriteriaEvaluator filters by trigger conditions (optional)
        └─ HMAC-signed POST → /route/batch on your routing engine

Routing Engine (Fastify)
  ├─ Validates HMAC signature
  ├─ Checks idempotency (Redis)
  ├─ Evaluates routing rules (multi-step branches, conditions, match config)
  ├─ Match step: cross-object duplicate detection (email, phone, domain, company)
  ├─ Round-robin team resolution (Redis Lua atomic INCR)
  ├─ Updates OwnerId in Salesforce via jsforce
  ├─ Failed updates → BullMQ retry queue (3x exponential backoff)
  ├─ Logs result + decision trace to PostgreSQL
  └─ Updates daily analytics aggregates

Management UI (Next.js)
  ├─ Visual Route Builder (multi-step branch canvas)
  ├─ AI-powered rule and trigger generation
  ├─ Scheduled route configuration (bulk search + assign)
  ├─ Round-robin team management (equal + weighted distribution)
  ├─ License user management (by individual, role, profile, queue)
  ├─ Analytics dashboard with daily/weekly/monthly views
  ├─ Routing log viewer with decision trace and record journey
  ├─ Connect Salesforce org via OAuth (PKCE)
  └─ Settings, API tokens, and org management
```

Everything runs in Docker on your own VPS. You keep full control of your data.

---

## Quick Start

### Prerequisites

- A Linux VPS (Ubuntu 22.04+ recommended) with SSH access — [Hetzner](https://www.hetzner.com), [DigitalOcean](https://digitalocean.com), [Vultr](https://vultr.com), etc.
- A Salesforce org with a Connected App configured (see [Salesforce Setup](#salesforce-setup))
- Node.js 20+ on your local machine
- Two public domain names pointed at your VPS (e.g. `leads.acme.com` and `engine.acme.com`)

### Install

```bash
npx @lead-routing/cli@latest init
```

The wizard will prompt you for:
1. VPS SSH credentials (host, user, key or password)
2. Your app URL and engine URL
3. Which CRM to connect (Salesforce or HubSpot)
4. Salesforce Connected App client ID and secret (Salesforce only)
5. Admin email and password

It then:
- SSHes into your VPS and installs Docker if needed
- Uploads `docker-compose.yml`, `.env` files, and a `Caddyfile`
- Starts all services (web app, routing engine, Postgres, Redis, Caddy)
- Runs database migrations and seeds your admin account
- **Drives CRM onboarding from the CLI itself** — opens your browser for the managed-package install (Salesforce only) and the OAuth Allow click, then deploys the Salesforce package, syncs field schemas, fires a test event, and marks onboarding complete
- All without you ever logging into the self-hosted web app

**Manual clicks during onboarding: 2 on Salesforce (package install + OAuth Allow), 1 on HubSpot (OAuth Allow). Everything else is programmatic.**

**Total time: ~10 minutes on a fresh VPS.**

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `lead-routing init` | Full interactive setup wizard — deploys the stack and runs the agentic CRM onboarding flow |
| `lead-routing init --skip-crm` | Infrastructure-only deploy — skips the CRM connect / field sync step |
| `lead-routing init --dry-run` | Generate config files locally without deploying |
| `lead-routing init --resume` | Resume an interrupted install from the health-check step |
| `lead-routing init --sandbox` | Use Salesforce sandbox (`test.salesforce.com`) |
| `lead-routing init --external-db <url>` | Use an external PostgreSQL instance |
| `lead-routing init --external-redis <url>` | Use an external Redis instance |
| `lead-routing deploy` | Pull latest images, restart services, run pending migrations |
| `lead-routing doctor` | Health check all services |
| `lead-routing status` | Show Docker container states |
| `lead-routing logs [service]` | Stream logs (`web`, `engine`, `postgres`, `redis`) |
| `lead-routing config show` | Print admin secret, app URL, and Salesforce client ID |
| `lead-routing config sfdc` | Update Salesforce Connected App credentials |
| `lead-routing sfdc deploy` | Redeploy the Salesforce package and run the agentic onboarding flow |
| `lead-routing sfdc connect` | Alias of `sfdc deploy` — emphasises the connect-and-onboard intent |
| `lead-routing login` | Authenticate with your Lead Routing instance |
| `lead-routing signup` | Create a new account |
| `lead-routing uninstall` | Full teardown — stops containers, wipes data, removes remote directory |

---

## Architecture

### Services

| Service | Port | Description |
|---------|------|-------------|
| `web` | 3000 | Next.js management dashboard |
| `engine` | 3001 | Fastify routing engine |
| `postgres` | 5432 | Primary database |
| `redis` | 6379 | Idempotency, round-robin state, rule cache, BullMQ |
| `caddy` | 80/443 | Reverse proxy + automatic HTTPS (Let's Encrypt) |

### Monorepo Structure

```
apps/
  web/          @lead-routing/web    — Next.js 16 management UI
  engine/       @lead-routing/engine — Fastify routing engine
  cli/          @lead-routing/cli    — Self-hosted installer CLI
  mcp/          @lead-routing/mcp    — MCP server for AI assistants
packages/
  db/           @lead-routing/db     — Prisma client + schema
  sfdc/         @lead-routing/sfdc   — jsforce helpers
license-server/ — Cloudflare Worker for license validation
site/           — Marketing site (static HTML)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind v4, shadcn/ui |
| Backend | Fastify v5, BullMQ v5, ioredis |
| Database | PostgreSQL 16 + Prisma ORM |
| Auth | iron-session (web), HMAC-SHA256 (engine), API tokens (Bearer) |
| Queue | BullMQ over Redis |
| Reverse proxy | Caddy (auto HTTPS) |
| Salesforce | Apex triggers, Custom Settings, REST API metadata deploy |
| CLI | Node.js, commander, @clack/prompts, node-ssh, tsup |
| License | Cloudflare Worker + D1 + Stripe |

---

## Salesforce Setup

Before running `init`, create a Salesforce Connected App:

1. In Salesforce Setup, go to **App Manager → New Connected App**
2. Enable **OAuth Settings**
3. Set the callback URL to: `https://your-app-url.com/api/auth/sfdc/callback`
4. Add scopes: `api`, `refresh_token`, `offline_access`
5. Note the **Consumer Key** (client ID) and **Consumer Secret**

The CLI wizard will prompt you for these values. The Salesforce package (Apex triggers, custom objects, permission sets) is deployed automatically during `init` — no Salesforce CLI required.

During onboarding the CLI:
1. Opens the managed-package install URL in your browser (one click — Salesforce requires this; there is no install API).
2. Opens the OAuth consent screen (one click — `Allow`). Tokens are captured via the CLI auth bridge so you never see the self-hosted web UI.
3. Deploys the package, patches Remote Site Settings + the Named Credential, writes `Routing_Settings__c`, syncs field schemas for Lead/Contact/Account, fires a test event, and marks onboarding complete — all programmatically.

---

## Updating

Pull the latest Docker images and restart services:

```bash
lead-routing deploy
```

This pulls the latest images, restarts containers, and applies any pending database migrations automatically.

---

## Local Development

### Requirements

- Node.js 20+
- pnpm 10.30.1
- Docker Desktop

### Setup

```bash
# Install dependencies
pnpm install

# Start all services
pnpm dev

# Build CLI
pnpm --filter @lead-routing/cli build

# Run tests
pnpm test
```

### Environment

Copy the example env files and fill in values:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/engine/.env.example apps/engine/.env
```

For Salesforce callouts during local development, expose the engine publicly:

```bash
ssh -R 80:localhost:3001 localhost.run
```

Then update `Engine_Endpoint__c` in Salesforce Custom Settings with the tunnel URL.

---

## Testing

```bash
pnpm test          # 1300+ unit tests
```

Tests cover:
- All 17 routing condition operators
- AND/OR group logic, catch-all rules, field name case normalization
- Route Builder branch evaluation and multi-step execution
- Round-robin assignment and weighted distribution
- Batch routing and bulk search queue processing
- Template generators (docker-compose, .env, Caddyfile)
- Password hashing, HMAC signature verification, API token auth
- License quota enforcement and reset logic

---

## Contributing

1. Fork the repo and create a feature branch
2. `pnpm install` — also installs the pre-push hook automatically
3. Make your changes
4. `pnpm test` to run the unit test suite
5. The pre-push hook runs the full test suite before every `git push`
6. Open a pull request

---

## License

MIT
