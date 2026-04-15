import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node24',
  clean: true,
  dts: false,
  // Bundle workspace packages (they export .ts files and won't run without a TS runtime).
  // All other deps (fastify, ioredis, bullmq, …) stay external — the Docker runner
  // installs them via pnpm install --prod.
  // @prisma/client is also external — it ships native query-engine binaries.
  noExternal: ['@lead-routing/db', '@lead-routing/sfdc', '@lead-routing/hubspot', '@lead-routing/crm-adapter'],
  external: ['@prisma/client', /generated\/prisma/],
})
