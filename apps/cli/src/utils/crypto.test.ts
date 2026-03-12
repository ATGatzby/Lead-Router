import { describe, it, expect } from 'vitest'
import { generateSecret } from './crypto.js'

describe('generateSecret', () => {
  it('returns a hex string', () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[0-9a-f]+$/)
  })

  it('default 32 bytes produces 64 hex chars', () => {
    const secret = generateSecret()
    expect(secret).toHaveLength(64)
  })

  it('custom byte length works (16 bytes → 32 hex chars)', () => {
    const secret = generateSecret(16)
    expect(secret).toHaveLength(32)
  })

  it('custom byte length works (64 bytes → 128 hex chars)', () => {
    const secret = generateSecret(64)
    expect(secret).toHaveLength(128)
  })

  it('each call produces different output', () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(a).not.toEqual(b)
  })
})
