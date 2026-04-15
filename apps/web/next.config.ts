import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Bundle the app into a minimal self-contained output for Docker.
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages (packages/db,
  // packages/sfdc) are included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Transpile workspace packages that ship raw TypeScript (no build step).
  transpilePackages: ['@lead-routing/agent-api'],
  // Keep ioredis and langfuse as server-side externals — they use native
  // modules or need to be traced into standalone output.
  serverExternalPackages: ['ioredis', 'langfuse'],
  typescript: {
    // Type-checking is done separately via `tsc --noEmit`.
    // Docker's hoisted node_modules resolves @prisma/client types
    // differently, causing ~105 false-positive implicit-any errors.
    ignoreBuildErrors: true,
  },
}

export default nextConfig
