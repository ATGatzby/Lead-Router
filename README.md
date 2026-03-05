# Lead Routing

> Self-hosted, Salesforce-native lead routing engine with round-robin assignment, rule-based conditions, and a Next.js management UI — deployed to your own server in minutes via a single CLI command.

[![npm version](https://img.shields.io/npm/v/@lead-routing/cli)](https://www.npmjs.com/package/@lead-routing/cli)
[![CI](https://github.com/ATGatzby/Lead-Router/actions/workflows/test.yml/badge.svg)](https://github.com/ATGatzby/Lead-Router/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What It Does

When a Lead, Contact, or Account is created or updated in Salesforce, Lead Routing automatically assigns the record's `OwnerId` to the right sales rep based on rules you configure in a web dashboard — with no code required.

**Key features:**
- Rule-based routing with 17 condition operators (equals, contains, greater than, date ranges, etc.)
- Round-robin assignment across teams with per-member pause/resume
- Salesforce queue support
- Dry-run mode — test rules without making live assignments
- Full routing history and audit logs
- HMAC-signed webhooks for secure Salesforce → engine communication
- 100% self-hosted — your data never leaves your server

---

## How It Works

```
Salesforce Org
  └─ Apex trigger fires on Lead/Contact/Account insert or update
       └─ HMAC-signed POST → /route on your routing engine

Routing Engine (Fastify)
  ├─ Validates HMAC signature
  ├─ Checks idempotency (Redis)
  ├─ Evaluates routing rules against record fields
  ├─ Updates OwnerId in Salesforce via jsforce
  └─ Logs result to PostgreSQL

Management UI (Next.js)
  ├─ Create and manage routing rules
  ├─ License users, manage round-robin teams
  ├─ View routing history and audit logs
  └─ Connect Salesforce org via OAuth
```

Everything runs in Docker on your own VPS. You keep full control of your data.

---

## Quick Start

### Prerequisites

- A Linux VPS (Ubuntu 22.04+ recommended) with SSH access — [Hetzner](https://www.hetzner.com), [DigitalOcean](https://digitalocean.com), [Vultr](https://vultr.com), etc.
- A Salesforce org with a Connected App configured (see [Salesforce Setup](#salesforce-setup))
- [Salesforce CLI (`sf`)](https://developer.salesforce.com/tools/salesforcecli) installed locally
- Node.js 20+ on your local machine
- Two public domain names pointed at your VPS (e.g. `leads.acme.com` and `engine.acme.com`)

### Install

```bash
npx @lead-routing/cli@latest init
```

The wizard will prompt you for:
1. VPS SSH credentials
2. Your app URL and engine URL
3. Salesforce Connected App client ID and secret
4. Admin email and password

It then:
- SSHes into your VPS and installs Docker if needed
- Uploads a `docker-compose.yml`, `.env` files, and a `Caddyfile`
- Starts all services (web app, routing engine, Postgres, Redis, Caddy)
- Runs database migrations and seeds your admin account
- Deploys the Salesforce package to your org
- Guides you through the in-app onboarding wizard

**Total time: ~10 minutes on a fresh VPS.**

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `lead-routing init` | Full interactive setup wizard |
| `lead-routing init --dry-run` | Generate config files locally without connecting or deploying |
| `lead-routing init --resume` | Resume an interrupted install from the health-check step |
| `lead-routing init --sandbox` | Use Salesforce sandbox (`test.salesforce.com`) |
| `lead-routing init --external-db <url>` | Use an external PostgreSQL instance instead of Docker-managed |
| `lead-routing init --external-redis <url>` | Use an external Redis instance instead of Docker-managed |
| `lead-routing deploy` | Pull latest Docker images, restart services, run pending migrations |
| `lead-routing doctor` | Health check all services |
| `lead-routing status` | Show Docker container states |
| `lead-routing logs [service]` | Stream logs (`web`, `engine`, `postgres`, `redis`) |
| `lead-routing config show` | Print admin secret, app URL, and Salesforce client ID |
| `lead-routing config sfdc` | Update Salesforce Connected App credentials |
| `lead-routing sfdc deploy` | Redeploy the Salesforce package (e.g. after an update) |
| `lead-routing uninstall` | Full teardown — stops containers, wipes data, removes remote directory |

---

## Architecture

### Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `web` | `ghcr.io/lead-routing/web` | 3000 | Next.js management dashboard |
| `engine` | `ghcr.io/lead-routing/engine` | 3001 | Fastify routing engine |
| `postgres` | `postgres:16` | 5432 | Primary database |
| `redis` | `redis:7` | 6379 | Idempotency, round-robin state, rule cache invalidation, BullMQ |
| `caddy` | `caddy:2` | 80/443 | Reverse proxy + automatic HTTPS (Let's Encrypt) |

### Monorepo Structure

```
apps/
  web/          @lead-routing/web    — Next.js 16 management UI
  engine/       @lead-routing/engine — Fastify routing engine
  cli/          @lead-routing/cli    — Self-hosted installer CLI
packages/
  db/           @lead-routing/db     — Prisma client + schema
  sfdc/         @lead-routing/sfdc   — jsforce helpers
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind v4, shadcn/ui |
| Backend | Fastify v5, BullMQ v5, ioredis |
| Database | PostgreSQL 16 + Prisma ORM |
| Auth | iron-session (web), HMAC-SHA256 (engine webhooks) |
| Queue | BullMQ over Redis |
| Reverse proxy | Caddy (auto HTTPS) |
| Salesforce | Apex triggers, Custom Settings, LWC onboarding wizard |
| CLI | Node.js 20, commander, @clack/prompts, node-ssh, tsup |

---

## Salesforce Setup

Before running `init`, create a Salesforce Connected App:

1. In Salesforce Setup, go to **App Manager → New Connected App**
2. Enable **OAuth Settings**
3. Set the callback URL to: `https://your-app-url.com/api/auth/sfdc/callback`
4. Add scopes: `api`, `refresh_token`, `offline_access`
5. Note the **Consumer Key** (client ID) and **Consumer Secret**

The CLI wizard will prompt you for these values. The Salesforce package (Apex triggers, custom objects, LWC wizard) is deployed automatically during `init`.

---

## Updating

Pull the latest Docker images and restart services:

```bash
lead-routing deploy
```

This pulls `ghcr.io/lead-routing/web:latest` and `ghcr.io/lead-routing/engine:latest`, restarts containers, and applies any pending database migrations automatically.

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

# Type-check
pnpm --filter @lead-routing/cli type-check
pnpm --filter @lead-routing/web type-check

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
pnpm test          # 120 unit tests (evaluator, templates, crypto)
```

Tests cover:
- All 17 routing condition operators (`equals`, `contains`, `gt`, `before`, `within_last`, etc.)
- AND/OR group logic, catch-all rules, field name case normalization
- Template generators (`docker-compose.yml`, `.env.web`, `Caddyfile`)
- Password hashing and HMAC signature verification

See [RegressionSuite.md](RegressionSuite.md) for the full manual regression checklist (T2–T4).

---

## Contributing

1. Fork the repo and create a feature branch
2. `pnpm install` — also installs the pre-push hook automatically
3. Make your changes
4. `pnpm test` to run the unit test suite
5. The pre-push hook runs the full T0+T1 suite before every `git push`
6. Open a pull request

---

## License

MIT
