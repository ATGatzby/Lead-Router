// Migrations have been moved into the web container's docker-entrypoint.sh.
// The entrypoint runs `prisma migrate deploy` on every container start (idempotent),
// and seed.js creates the initial admin user if ADMIN_EMAIL + ADMIN_PASSWORD are set.
//
// This file is kept as a placeholder to avoid broken imports in any downstream code.
// The SSH tunnel + local Prisma approach is no longer used.
