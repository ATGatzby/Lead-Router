# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app

# Copy monorepo manifests first (layer-cache friendly)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.cjs ./
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/mcp/tsup.config.ts ./apps/mcp/
COPY apps/mcp/tsconfig.json ./apps/mcp/

# Install all deps (including devDeps — needed for tsup/esbuild)
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy full source
COPY apps/mcp/src/ ./apps/mcp/src/

# Build
RUN pnpm --filter @lead-routing/mcp build


# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/apps/mcp/dist/ ./dist/
COPY --from=builder /app/apps/mcp/package.json ./

RUN npm install --omit=dev

EXPOSE 3002

CMD ["node", "dist/index.js", "--http", "--oauth", "--port", "3002", "--host", "0.0.0.0"]
