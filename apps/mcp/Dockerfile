# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app

# Copy monorepo manifests + ALL workspace package.jsons
# pnpm needs every package listed in pnpm-workspace.yaml to be present
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.cjs ./
COPY apps/cli/package.json        ./apps/cli/
COPY apps/engine/package.json     ./apps/engine/
COPY apps/mcp/package.json        ./apps/mcp/
COPY apps/web/package.json        ./apps/web/
COPY packages/agent-api/package.json  ./packages/agent-api/
COPY packages/crm-adapter/package.json ./packages/crm-adapter/
COPY packages/db/package.json     ./packages/db/
COPY packages/hubspot/package.json ./packages/hubspot/
COPY packages/sfdc/package.json   ./packages/sfdc/

# MCP build config
COPY apps/mcp/tsup.config.ts ./apps/mcp/
COPY apps/mcp/tsconfig.json  ./apps/mcp/

# Install all deps (esbuild platform binaries need full workspace resolution)
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy MCP source only
COPY apps/mcp/src/ ./apps/mcp/src/

# Build — use DEBUG for verbose esbuild output on failure
RUN DEBUG="*" pnpm --filter @lead-routing/mcp build 2>&1 || \
    (echo "=== Build failed. Checking esbuild ===" && \
     node_modules/.bin/esbuild --version && \
     echo "=== esbuild works ===" || echo "=== esbuild binary broken ===" && \
     exit 1)


# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/apps/mcp/dist/ ./dist/
COPY --from=builder /app/apps/mcp/package.json ./

RUN npm install --omit=dev

EXPOSE 3002

CMD ["node", "dist/index.js", "--http", "--oauth", "--port", "3002", "--host", "0.0.0.0"]
