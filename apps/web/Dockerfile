# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app

# Copy manifests first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json      ./apps/web/
COPY packages/db/package.json   ./packages/db/
COPY packages/sfdc/package.json ./packages/sfdc/

# Install all deps (devDeps included — needed for next build, prisma generate)
RUN pnpm install --no-frozen-lockfile --shamefully-hoist

# Copy full source
COPY apps/web/     ./apps/web/
COPY packages/db/  ./packages/db/
COPY packages/sfdc/ ./packages/sfdc/

# Generate Prisma client into root node_modules/@prisma + node_modules/.prisma
RUN node_modules/.bin/prisma generate --schema=packages/db/prisma/schema.prisma

# Build Next.js (produces .next/standalone via output: 'standalone')
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @lead-routing/web build


# ── Stage 2: Install Prisma CLI cleanly (no pnpm interference) ───────────────
FROM node:24-alpine AS prisma-installer

WORKDIR /prisma-pkg
RUN npm init -y && npm install prisma@6


# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 1) Standalone output FIRST (includes Next.js runtime + minimal node_modules)
COPY --from=builder /app/apps/web/.next/standalone ./

# 2) Prisma CLI + all deps ON TOP (overwrites any broken prisma traces from standalone)
COPY --from=prisma-installer /prisma-pkg/node_modules ./node_modules

# 3) Generated Prisma client — needed for runtime database queries
COPY --from=builder /app/node_modules/.prisma        ./node_modules/.prisma

# Static assets and public files
COPY --from=builder /app/apps/web/.next/static  ./apps/web/.next/static
COPY --from=builder /app/apps/web/public        ./apps/web/public

# Prisma schema + migrations — needed for `prisma migrate deploy`
COPY --from=builder /app/packages/db/prisma          ./packages/db/prisma

# Entrypoint: run migrations + seed, then start Next.js
COPY apps/web/docker-entrypoint.sh ./docker-entrypoint.sh
COPY apps/web/seed.js              ./apps/web/seed.js
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
