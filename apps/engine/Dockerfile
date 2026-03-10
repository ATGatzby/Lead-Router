# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Enable pnpm via corepack (matches packageManager field in root package.json)
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app

# Copy monorepo manifests first (layer-cache friendly)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.cjs ./
COPY apps/engine/package.json ./apps/engine/
COPY packages/db/package.json     ./packages/db/
COPY packages/sfdc/package.json   ./packages/sfdc/

# Install all deps (including devDeps — needed for tsc, tsup, prisma)
# --shamefully-hoist flattens node_modules so files can be COPY'd cleanly
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy full source after deps are cached
COPY apps/engine/   ./apps/engine/
COPY packages/db/   ./packages/db/
COPY packages/sfdc/ ./packages/sfdc/

# Generate Prisma client into root node_modules/@prisma + node_modules/.prisma
# Run from /app so the output lands in /app/node_modules, not packages/db/node_modules
RUN node_modules/.bin/prisma generate --schema=packages/db/prisma/schema.prisma

# Bundle engine + inline workspace packages into dist/server.js.
# @prisma/client is kept external (it ships native query-engine binaries).
RUN pnpm --filter @lead-routing/engine build:prod


# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM node:24-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app
ENV NODE_ENV=production

# Copy manifests to install production deps (fastify, bullmq, ioredis, etc.)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.cjs ./
COPY apps/engine/package.json  ./apps/engine/
COPY packages/db/package.json  ./packages/db/
COPY packages/sfdc/package.json ./packages/sfdc/
RUN pnpm install --frozen-lockfile --prod --shamefully-hoist

# Bundled engine (workspace packages inlined by tsup)
COPY --from=builder /app/apps/engine/dist ./dist

# Prisma JS wrapper + native query-engine binary
COPY --from=builder /app/node_modules/.prisma      ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma      ./node_modules/@prisma

# Prisma schema — required by `prisma migrate deploy` run from the CLI
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3001

CMD ["node", "dist/server.js"]
