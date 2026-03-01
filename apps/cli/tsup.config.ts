import { defineConfig } from 'tsup'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  async onSuccess() {
    // Copy sfdc-package into dist so the installed CLI can find it
    const sfdcSrc = join(__dirname, 'sfdc-package')
    const sfdcDst = join(__dirname, 'dist', 'sfdc-package')
    if (existsSync(sfdcSrc)) {
      rmSync(sfdcDst, { recursive: true, force: true })
      cpSync(sfdcSrc, sfdcDst, { recursive: true, filter: (f) => !f.includes('/.sf') })
      console.log('Copied sfdc-package → dist/sfdc-package')
    } else {
      console.warn('sfdc-package not found — run pnpm prepare to copy it from the repo root')
    }

    // Copy prisma schema + migrations into dist so the CLI can run migrations
    // when installed globally (no monorepo node_modules available)
    const prismaSrc = join(__dirname, '../../packages/db/prisma')
    const prismaDst = join(__dirname, 'dist', 'prisma')
    if (existsSync(prismaSrc)) {
      rmSync(prismaDst, { recursive: true, force: true })
      cpSync(prismaSrc, prismaDst, { recursive: true })
      console.log('Copied packages/db/prisma → dist/prisma')
    } else {
      console.warn('packages/db/prisma not found')
    }
  },
})
