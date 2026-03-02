# Plan: Publish @lead-routing/cli to npm for `npx` Usage

## Context

The CLI is fully functional (SSH-based remote deploy, Salesforce onboarding verified end-to-end). The goal is to publish `@lead-routing/cli` to npm so customers can install and run it with:

```bash
npx @lead-routing/cli@latest init
```

Currently there is no automated publishing workflow. A stale `lead-routing-cli-0.1.0.tgz` pack artifact exists in `apps/cli/` (leftover from a manual `pnpm pack`). The existing GitHub Actions workflow (`publish-images.yml`) only handles Docker images.

The build is already set up correctly:
- `tsup.config.ts` bundles dist/index.js + copies `dist/prisma/` + `dist/sfdc-package/`
- `"files": ["dist/"]` restricts the npm tarball to only the compiled output
- `node-ssh` and `prisma` are kept as runtime npm dependencies (NOT bundled) — correct

---

## What Needs to Change

### 1. `apps/cli/package.json` — Required additions

**a) `publishConfig`** — without this, `npm publish` fails for scoped packages (`@lead-routing/*`) unless `--access public` is passed every time:
```json
"publishConfig": { "access": "public" }
```

**b) `engines`** — enforces Node 20+ at install time, prevents customers on old Node from installing:
```json
"engines": { "node": ">=20" }
```

**c) `prepublishOnly` script** — ensures a fresh `dist/` is always built before any manual `npm publish` (safety net in addition to CI):
```json
"prepublishOnly": "pnpm build"
```

**d) npm discoverability metadata:**
```json
"homepage": "https://github.com/lead-routing/lead-routing",
"keywords": ["salesforce", "lead-routing", "self-hosted", "deployment", "cli"]
```

### 2. Root `.gitignore` — Remove stale `.tgz` artifact

`apps/cli/lead-routing-cli-0.1.0.tgz` is currently untracked. Add to root `.gitignore`:
```
apps/cli/*.tgz
```

### 3. New file: `.github/workflows/publish-cli.yml`

**Trigger:** Push a Git tag matching `cli-v*` (e.g. `cli-v0.1.0`) OR manual `workflow_dispatch`.

This decouples CLI releases from Docker image releases (which trigger on any push to `main`).

**Full workflow:**
```yaml
name: Publish CLI to npm

on:
  push:
    tags:
      - 'cli-v*'
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.30.1

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build CLI
        run: pnpm --filter @lead-routing/cli build

      - name: Publish to npm
        run: npm publish --access public
        working-directory: apps/cli
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Required one-time setup by user:**
- Create npm automation token at npmjs.com → Account → Access Tokens → Generate → Automation
- Add as GitHub secret: repo Settings → Secrets → Actions → `NPM_TOKEN`

### 4. Version bump workflow (ongoing)

Simple manual process, no changesets needed at this stage:
1. Edit `version` in `apps/cli/package.json` (e.g. `"0.1.0"` → `"0.2.0"`)
2. Commit: `git commit -m "chore(cli): bump version to 0.2.0"`
3. Push tag: `git tag cli-v0.2.0 && git push origin cli-v0.2.0`
4. GitHub Actions runs → publishes to npm automatically

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/cli/package.json` | Add `publishConfig`, `engines`, `prepublishOnly`, metadata fields |
| `.gitignore` (root) | Add `apps/cli/*.tgz` |

## Files to Create

| File | Purpose |
|------|---------|
| `.github/workflows/publish-cli.yml` | Auto-publish CLI to npm on `cli-v*` tag push |

---

## Runtime Dependency Notes (no changes needed)

| Dependency | Why it stays external |
|-----------|----------------------|
| `node-ssh@^13.2.1` | Has optional native `.node` modules — bundling breaks. Pure-JS fallback works everywhere. |
| `prisma@^6.5.0` | Ships precompiled query engine binaries per platform. Cannot be bundled. npm selects correct binary at install time. |
| `@prisma/client@^6.5.0` | Required by Prisma internals at runtime. |
| `execa`, `chalk`, `commander`, `@clack/prompts` | Pure JS — could be bundled but no reason to (small, stable deps). |

**Prisma schema/migrations** are bundled into `dist/prisma/` (copied by `tsup onSuccess` hook) — no monorepo access needed at runtime.
**Salesforce package** is bundled into `dist/sfdc-package/` (same hook) — correct.

---

## Verification

**Before publishing (local):**
```bash
cd apps/cli
pnpm build
npm pack --dry-run
# Verify output lists:
#   dist/index.js
#   dist/prisma/schema.prisma
#   dist/prisma/migrations/ (4 files)
#   dist/sfdc-package/ (47 files)
#   package.json
```

**Test with local tarball before first publish:**
```bash
cd apps/cli
npm pack
npx ./lead-routing-cli-0.1.0.tgz --version
# Expected: 0.1.0
npx ./lead-routing-cli-0.1.0.tgz init --help
# Expected: shows init command options
```

**After publishing:**
```bash
npx @lead-routing/cli@latest --version
npm install -g @lead-routing/cli
lead-routing init
```

**CI verification:**
- Push `cli-v0.1.0` tag → check Actions tab → confirm publish job passes → confirm `npm info @lead-routing/cli` shows the package
