# Flow Enhancement — v0.1.6 Friction Audit

## Problem Statement

A full audit of the CLI customer flow (`lead-routing init`) revealed two categories of problems blocking a seamless first-run experience:

1. **Too many prompts** — 24 prompts asked the user for things the CLI could figure out itself (SSH key detection, sane defaults for port/username/install dir, always-Docker services, always-production Salesforce, Resend not needed at install time).

2. **Wrong prompt ordering** — SSH credentials were collected in step 2, but the SSH connection was not attempted until step 5 — after the user had spent 15 minutes answering app URLs, Salesforce credentials, and admin account details. A bad hostname or wrong SSH key caused a late failure with all that input wasted.

---

## What Changed

### Prompt Elimination (12 prompts removed)

| Prompt | Was | Now |
|---|---|---|
| SSH port | Always prompted (default 22) | Defaults to 22; override with `--ssh-port` |
| SSH username | Always prompted (default root) | Defaults to root; override with `--ssh-user` |
| SSH auth method select | Always prompted | Eliminated — auto-detect decides |
| SSH key path | Prompted if key auth selected | Auto-detected from `~/.ssh/id_ed25519` → `id_rsa` → `id_ecdsa`; override with `--ssh-key` |
| Remote install directory | Always prompted (default ~/lead-routing) | Defaults to ~/lead-routing; override with `--remote-dir` |
| SFDC org alias | Always prompted (default lead-routing) | Hardcoded to 'lead-routing' — not user-facing |
| SFDC environment | Select between Production/Sandbox | Defaults to Production; `--sandbox` flag for sandbox |
| Manage PostgreSQL? | Confirm prompt | Default true (always managed); `--external-db <url>` for override |
| Manage Redis? | Confirm prompt | Default true (always managed); `--external-redis <url>` for override |
| Resend email confirm | Always prompted | Removed from init — configure post-install |
| Resend API key | If Resend enabled | Removed from init |
| Resend feedback email | If Resend enabled | Removed from init |

### Before vs After: Prompt Count

| Scenario | Before (v0.1.4) | After (v0.1.6) |
|---|---|---|
| Happy path (default SSH key exists) | ~24 prompts | **7 prompts** |
| No default SSH key (password auth) | ~24 prompts | **8 prompts** |
| Power user (`--sandbox --ssh-key`) | ~24 prompts | **6 prompts** |

### Early SSH Validation

SSH connection is now tested **immediately after step 2** (after collecting hostname and detecting the key), before any app config prompts begin.

```
Step 2/9  SSH connection
◇  Server hostname or IP address: 165.22.100.50
○  Using SSH key: ~/.ssh/id_ed25519
✔  Connected to 165.22.100.50      ← VALIDATES BEFORE step 3 begins

Step 3/9  Configuration
◇  App URL...
◇  Engine URL...
```

If SSH fails (wrong host, wrong key, firewall), the error appears immediately and the user can fix it before investing time in app config.

### SSH Key Auto-Detection

The auth method select + key path prompt (2 prompts) are replaced with silent auto-detection:

```typescript
const DEFAULT_KEYS = [
  '~/.ssh/id_ed25519',  // preferred (Ed25519)
  '~/.ssh/id_rsa',      // RSA fallback
  '~/.ssh/id_ecdsa',    // ECDSA fallback
]
// First existing file wins — shown as info line, never prompted
```

If none of the standard keys exist, falls back to a password prompt — no auth method select needed.

### New CLI Flags

```bash
# Salesforce
lead-routing init --sandbox                    # Use test.salesforce.com

# SSH overrides (for non-standard setups)
lead-routing init --ssh-port 2222
lead-routing init --ssh-user ubuntu
lead-routing init --ssh-key ~/.ssh/my_vps_key
lead-routing init --remote-dir /opt/lead-routing

# External services (skip managed Docker containers)
lead-routing init --external-db postgresql://user:pass@rds.aws.com/db
lead-routing init --external-redis rediss://user:pass@elasticache.aws.com
```

---

## What the Happy Path Looks Like Now

```
◆  Lead Routing — Self-Hosted Setup

●  Step 1/9  Checking local prerequisites
✔  Node.js 22.x — OK
✔  Salesforce CLI (sf) — OK

●  Step 2/9  SSH connection
◇  Server hostname or IP address: 165.22.100.50
○  Using SSH key: ~/.ssh/id_ed25519
✔  Connected to 165.22.100.50

●  Step 3/9  Configuration
┌  Before you begin
│  You will need:
│    • A Salesforce Connected App (Client ID + Secret)
│    • Public HTTPS URLs for the web app and routing engine
└

◇  App URL: https://leads.acme.com
◇  Engine URL: https://engine.acme.com
┌  Salesforce Connected App setup
│  ...callback URL pre-filled...
└
◇  Consumer Key: 3MVG9...
◇  Consumer Secret: ••••••••
┌  Admin Account
└
◇  Admin email: admin@acme.com
◇  Admin password: ••••••••

●  Step 4/9  Generating config files
...
●  Step 5/9  Remote setup
...
[steps 6-9 run automatically]

◆  ✔  You're live!
   Dashboard: https://leads.acme.com
```

---

## Audit Findings (Full List)

The audit identified 26 prompts across the flow. Below is the complete breakdown:

### Truly Required (cannot be removed or defaulted)
1. Server hostname
2. App URL
3. Engine URL
4. Salesforce Consumer Key
5. Salesforce Consumer Secret
6. Admin email
7. Admin password
8. SSH password (only when no standard key exists)

### Eliminated in v0.1.6
9–20. See table above — 12 prompts removed.

### Deferred to Post-Install
- Resend API key + feedback email → not needed for initial operation
- Custom Salesforce org alias → always 'lead-routing' (internal implementation detail)

### Deferred to Future Rounds
- `~/.ssh/config` parsing for host-specific port/user/key
- DB password stored in lead-routing.json for direct DB access
- `--env-file` flag for CI/CD headless installs (unattended `npx`)
- Disk space / RAM pre-flight checks on the VPS
- `lead-routing config resend` command for post-install Resend setup

---

## Files Changed

| File | Change |
|---|---|
| `apps/cli/src/steps/collect-ssh-config.ts` | Major rewrite — 5 prompts removed, SSH key auto-detection, `SshCollectOptions` param |
| `apps/cli/src/steps/collect-config.ts` | Major rewrite — 7 prompts removed, `ConfigCollectOptions` param, orgAlias hardcoded |
| `apps/cli/src/commands/init.ts` | Early SSH connect added between steps 2 and 3; opts passed to collection steps |
| `apps/cli/src/index.ts` | 7 new flags added to `init` command |

---

## Version

Shipped in `@lead-routing/cli@0.1.6`.
