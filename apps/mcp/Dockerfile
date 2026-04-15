FROM node:20-slim AS builder

WORKDIR /app

# Copy package files for install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp/package.json apps/mcp/
COPY apps/mcp/tsup.config.ts apps/mcp/
COPY apps/mcp/tsconfig.json apps/mcp/
COPY apps/mcp/src/ apps/mcp/src/

# Install pnpm and dependencies
RUN npm install -g pnpm@10.30.1 && \
    pnpm install --filter @lead-routing/mcp --shamefully-hoist

# Build using pnpm (not npx — avoids esbuild native binary issues)
RUN pnpm --filter @lead-routing/mcp build

# --- Runner ---
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/apps/mcp/dist/ ./dist/
COPY --from=builder /app/apps/mcp/package.json ./

RUN npm install --omit=dev

EXPOSE 3002

CMD ["node", "dist/index.js", "--http", "--oauth", "--port", "3002", "--host", "0.0.0.0"]
