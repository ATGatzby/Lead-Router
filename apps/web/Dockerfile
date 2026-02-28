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


# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Standalone output includes its own minimal node_modules
COPY --from=builder /app/apps/web/.next/standalone ./

# Static assets and public files must be copied separately
COPY --from=builder /app/apps/web/.next/static  ./apps/web/.next/static
COPY --from=builder /app/apps/web/public        ./apps/web/public

# Prisma CLI + engines + generated client — needed for `prisma migrate deploy`
# and for the Next.js app's database queries at runtime.
# @prisma/engines contains the native migration engine binary (not traced by Next.js standalone).
COPY --from=builder /app/node_modules/.bin/prisma    ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma         ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma        ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=builder /app/packages/db/prisma          ./packages/db/prisma

EXPOSE 3000

# Next.js standalone server entry point
CMD ["node", "apps/web/server.js"]
