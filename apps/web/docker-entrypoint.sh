#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node ./node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma

# Seed admin user on first run (if ADMIN_EMAIL is set and no org exists yet)
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Checking if seed is needed..."
  node apps/web/seed.js
fi

echo "[entrypoint] Starting Next.js..."
exec node apps/web/server.js
