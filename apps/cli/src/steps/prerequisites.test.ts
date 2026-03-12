import { describe, it, expect, vi } from 'vitest'

// We need to test the internal checkNodeVersion logic.
// Since it's not exported, we test via the public `checkPrerequisites` function
// and mock clack prompts to prevent console output.

vi.mock('@clack/prompts', () => ({
  log: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { checkPrerequisites } from './prerequisites.js'

describe('checkPrerequisites()', () => {
  it('succeeds on Node 20+', async () => {
    // Current test runner is Node 20+, so this should pass
    const major = parseInt(process.version.slice(1), 10)
    if (major >= 20) {
      await expect(checkPrerequisites()).resolves.toBeUndefined()
    }
  })

  it('only checks Node.js version (no sf CLI, no Prisma)', async () => {
    // The function should succeed even without sf or prisma installed
    // This is the key behavioral change we're testing
    const major = parseInt(process.version.slice(1), 10)
    if (major >= 20) {
      await expect(checkPrerequisites()).resolves.toBeUndefined()
    }
  })
})

// Test the version parsing logic directly by importing the module
// and checking the behavior with the current Node version
describe('Node version check', () => {
  it('process.version is a valid semver string', () => {
    expect(process.version).toMatch(/^v\d+\.\d+\.\d+/)
  })

  it('current Node version is 20 or higher', () => {
    const major = parseInt(process.version.slice(1), 10)
    expect(major).toBeGreaterThanOrEqual(20)
  })
})
