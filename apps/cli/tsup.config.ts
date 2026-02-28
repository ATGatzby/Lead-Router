import { defineConfig } from 'tsup'
import { cpSync, existsSync } from 'node:fs'
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
    const src = join(__dirname, 'sfdc-package')
    const dst = join(__dirname, 'dist', 'sfdc-package')
    if (existsSync(src)) {
      cpSync(src, dst, { recursive: true })
      console.log('Copied sfdc-package → dist/sfdc-package')
    } else {
      console.warn('sfdc-package not found — run pnpm prepare to copy it from the repo root')
    }
  },
})
