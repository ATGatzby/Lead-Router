import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Bundle the app into a minimal self-contained output for Docker.
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages (packages/db,
  // packages/sfdc) are included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Keep ioredis as a server-side external — it uses native modules that
  // break Next.js bundling in CI Docker builds.
  serverExternalPackages: ['ioredis'],
}

export default nextConfig
