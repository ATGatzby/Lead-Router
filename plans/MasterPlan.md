# Lead Routing Software for Salesforce — Master Plan

**Product:** Lead Routing Software for Salesforce
**Version:** 1.0 MVP
**Target Market:** India (RevOps / Sales teams using Salesforce)
**Inspired by:** RingLead, Lean Data
**Date:** February 23, 2026

---

## 1. Product Summary

A two-layer SaaS product that enables real-time, rules-based lead assignment directly within Salesforce:

| Layer | Description |
|---|---|
| **Salesforce Managed Package** | Apex Triggers installed in customer's SFDC org — thin event emitter only. No routing logic lives here. |
| **Cloud Web App** | Rules configuration UI + real-time routing engine + audit logs. All business logic lives here. |

**Core Value:** Route Leads, Contacts, and Accounts to the right sales rep within seconds of a SFDC record being created or updated — no manual assignment, no delays.

---

## 2. Architecture Overview

```
Salesforce Org                      Cloud App (our product)
────────────────────                ─────────────────────────────────────
Apex Trigger                        Next.js Web App (Config UI)
  Lead / Contact / Account    ──►       API Routes (CRUD)
  Insert / Update events              PostgreSQL (rules, logs, users)
  JSON payload callout                     │
         │                           Fastify Routing Engine
         └────────────────────────►      Rule evaluation
                                         Round Robin (Redis atomic)
                                         Retry queue (BullMQ)
                                              │
                                    ◄─────────┘
                               SFDC REST API
                               (OwnerId update)
```

**Architectural Principle:** SFDC package = thin event emitter. All business logic in cloud app. Zero routing logic in Apex.

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript | SSR, file-based routing, API routes in one repo |
| UI | Tailwind CSS + shadcn/ui | Production-quality components fast |
| Server State | TanStack Query | Caching, real-time invalidation |
| Client State | Zustand | Lightweight — rule builder, drag-drop ordering |
| Backend API | Next.js API Routes | CRUD for users, teams, rules, licensing |
| Routing Engine | Fastify (separate service) | Isolated, horizontally scalable, high throughput |
| Database | PostgreSQL + Prisma ORM | Relational model fits routing rules structure |
| Cache / Queue | Redis (Upstash) + BullMQ | Atomic Round Robin pointers, retry queue |
| SFDC Client | jsforce (Node.js) | SFDC REST API — OwnerId updates, user sync |
| SFDC Package | Apex Triggers + LWC | Event emitter + onboarding wizard |
| Auth | Salesforce OAuth 2.0 | SSO via Connected App — no separate auth system |
| Monorepo | Turborepo | `apps/web`, `apps/engine`, `packages/db`, `packages/sfdc` |
| Hosting | Cloud-agnostic (decide post-MVP) | Build with env vars, deploy anywhere |

---

## 4. Database Schema

```
organizations     (id, sfdc_org_id, oauth_access_token, oauth_refresh_token, seats_purchased, seats_used)
users             (id, org_id, sfdc_user_id, name, email, role, profile, is_licensed, last_routed_at)
round_robin_teams (id, org_id, name, description, pointer_index)
team_members      (id, team_id, user_id, status: active|paused, weight, assignment_count)
routing_rules     (id, org_id, object_type, trigger_event, name, priority, status, assignment_type, assignee_id)
rule_conditions   (id, rule_id, group_id, field_name, operator, value, conjunction: and|or)
routing_logs      (id, org_id, sfdc_record_id, object_type, event_type, rule_id, assignee_id, status, error_msg, created_at)
audit_logs        (id, org_id, actor_id, action, entity_type, entity_id, before_state, after_state, created_at)
sfdc_queues       (id, org_id, sfdc_queue_id, name, synced_at)
field_schemas     (id, org_id, object_type, field_api_name, field_label, field_type)
```

---

## 5. Phase Overview

| Phase | Name | Weeks | Status |
|---|---|---|---|
| [Phase 1](./Phase1-Scaffold-Auth.md) | Project Scaffold + Auth | Week 1 | ⬜ Not Started |
| [Phase 2](./Phase2-License-Users.md) | License Users Module | Week 1–2 | ⬜ Not Started |
| [Phase 3](./Phase3-Round-Robin-Teams.md) | Round Robin Teams | Week 2–3 | ⬜ Not Started |
| [Phase 4](./Phase4-Routing-Rules-Builder.md) | Routing Rules Builder | Week 3–5 | ⬜ Not Started |
| [Phase 5](./Phase5-Routing-Engine.md) | Routing Engine | Week 5–7 | ⬜ Not Started |
| [Phase 6](./Phase6-History-Audit.md) | Routing History & Audit | Week 7–8 | ⬜ Not Started |
| [Phase 7](./Phase7-SFDC-Managed-Package.md) | SFDC Managed Package | Week 8–10 | ⬜ Not Started |
| [Phase 8](./Phase8-India-Polish.md) | India-Specific + Polish | Week 10–11 | ⬜ Not Started |

**Status legend:** ⬜ Not Started · 🔵 In Progress · ✅ Complete · 🔴 Blocked

---

## 6. India Market Differentiators

| Feature | Rationale |
|---|---|
| INR pricing | RingLead prices in USD — friction for Indian buyers |
| WhatsApp notification webhook template | Indian sales teams run on WhatsApp, not Slack |
| Data residency option (AWS Mumbai) | Procurement requirement for many Indian enterprises |
| SMB-friendly seat tiers | RingLead is enterprise-priced; India market needs ₹3k–₹15k/month range |
| GST invoice generation | Mandatory for Indian B2B SaaS billing |

---

## 7. Open Questions — Resolved

| # | Question | Decision |
|---|---|---|
| OQ-1 | Match-all mode in v1? | **Defer to v2.** First-match-wins covers 95% of use cases. |
| OQ-2 | Max conditions per rule? | **50 conditions** per rule — in-memory evaluation, no perf issue. |
| OQ-3 | Queue assignment consumes seat? | **No.** Queues are SFDC-native. |
| OQ-4 | SFDC API limit exhausted? | **Queue and retry** — never drop records. Surface alert to admin. |
| OQ-5 | Sandbox + prod under one subscription? | **Yes.** Sandbox should not cost extra. |
| OQ-6 | SSO vs standalone auth? | **SFDC OAuth for v1.** Eliminates a separate auth system. |

---

## 8. Non-Functional Targets

| Category | Target |
|---|---|
| Routing latency (p95) | < 5 seconds end-to-end |
| Concurrent events | 500 events/second minimum |
| Routing delivery SLA | > 99.9% (excl. SFDC downtime) |
| App uptime | 99.9% monthly |
| Log retention | 12 months minimum |
| Security | TLS 1.2+, OAuth 2.0, HMAC webhook signatures |

---

## 9. Out of Scope (v1)

- AI/ML-based lead scoring or predictive routing
- Native mobile application
- Non-Salesforce CRM integrations (HubSpot, Dynamics, etc.)
- Built-in email/SMS notification system
- Territory management with geographic routing
- SLA / response time tracking per rep
- Match-all rules mode (multi-assignment)

---

## 10. Key Files Reference

| Path | Purpose |
|---|---|
| `packages/db/prisma/schema.prisma` | Single source of truth for all DB tables |
| `packages/sfdc/src/client.ts` | jsforce OAuth client, token refresh |
| `packages/sfdc/src/users.ts` | SFDC user sync |
| `packages/sfdc/src/schema.ts` | `describeSObject` for field schema sync |
| `apps/engine/src/evaluator.ts` | Core condition evaluation logic |
| `apps/engine/src/round-robin.ts` | Redis atomic pointer |
| `apps/engine/src/queue.ts` | BullMQ retry + dead-letter queue |
| `apps/web/components/condition-builder/` | Most complex UI component |
| `sfdc-package/force-app/main/default/triggers/` | Apex triggers |

---

## 11. Feasibility via Claude Code

| Component | Feasibility |
|---|---|
| Next.js web app (all pages/UI) | ✅ Full build |
| PostgreSQL schema + Prisma | ✅ Full build |
| Routing engine (conditions, RR, retry) | ✅ Full build |
| Salesforce OAuth + jsforce | ✅ Full build |
| Redis atomic Round Robin | ✅ Full build |
| BullMQ retry/DLQ | ✅ Full build |
| Apex Trigger code | ✅ Code generatable — needs SFDC org to deploy/test |
| AppExchange security review | ⚠️ Process (6–8 weeks), not a code problem |
| Infrastructure provisioning | ✅ Docker + IaC configs generatable |

**Verdict:** ~80% of the product is fully buildable via Claude Code. The SFDC managed package code is generatable; deployment validation requires the Developer org (which is available).
