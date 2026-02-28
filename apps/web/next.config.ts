import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Bundle the app into a minimal self-contained output for Docker.
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages (packages/db,
  // packages/sfdc) are included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

export default nextConfig
