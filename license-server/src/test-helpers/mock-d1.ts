/**
 * In-memory D1 mock for testing route handlers.
 * Supports the query patterns used by the license-server db functions.
 */

import type { License } from '../lib/db'

export interface MockD1 {
  prepare: (sql: string) => MockStatement
  /** Direct access to the in-memory store */
  _licenses: Map<string, License>
  /** Add a license row to the mock store */
  _addLicense: (license: License) => void
}

interface MockStatement {
  bind: (...args: any[]) => MockBound
}

interface MockBound {
  first: <T = any>() => Promise<T | null>
  run: () => Promise<{ success: boolean }>
  all: <T = any>() => Promise<{ results: T[] }>
}

export function createMockD1(): MockD1 {
  const licenses = new Map<string, License>()

  const mock: MockD1 = {
    _licenses: licenses,
    _addLicense: (license: License) => {
      licenses.set(license.key, license)
    },
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async <T = any>(): Promise<T | null> => {
          // SELECT by key
          if (sql.includes('WHERE key = ?')) {
            const key = args[0] as string
            return (licenses.get(key) as T) ?? null
          }
          // SELECT by subscriptionId
          if (sql.includes('WHERE stripeSubscriptionId = ?')) {
            const subId = args[0] as string
            for (const lic of licenses.values()) {
              if (lic.stripeSubscriptionId === subId) return lic as T
            }
            return null
          }
          return null
        },
        run: async () => {
          // INSERT
          if (sql.startsWith('INSERT INTO licenses')) {
            const newLicense: License = {
              id: args[0],
              key: args[1],
              jwt: args[2],
              email: args[3],
              tier: args[4],
              stripeCustomerId: args[5],
              stripeSubscriptionId: args[6],
              validUntil: args[7],
              graceUntil: null,
              serverFingerprint: null,
              lastHeartbeat: null,
              isActive: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            licenses.set(newLicense.key, newLicense)
          }
          // UPDATE fingerprint
          if (sql.includes('SET serverFingerprint')) {
            const fingerprint = args[0] as string
            const key = args[1] as string
            const lic = licenses.get(key)
            if (lic) {
              lic.serverFingerprint = fingerprint
              lic.updatedAt = new Date().toISOString()
            }
          }
          // UPDATE heartbeat
          if (sql.includes('SET lastHeartbeat')) {
            const timestamp = args[0] as string
            const key = args[1] as string
            const lic = licenses.get(key)
            if (lic) {
              lic.lastHeartbeat = timestamp
              lic.updatedAt = new Date().toISOString()
            }
          }
          // UPDATE validUntil (extend)
          if (sql.includes('SET validUntil')) {
            const newValidUntil = args[0] as string
            const subId = args[1] as string
            for (const lic of licenses.values()) {
              if (lic.stripeSubscriptionId === subId) {
                lic.validUntil = newValidUntil
                lic.graceUntil = null
                lic.updatedAt = new Date().toISOString()
              }
            }
          }
          // UPDATE graceUntil
          if (sql.includes('SET graceUntil')) {
            const graceUntil = args[0] as string
            const subId = args[1] as string
            for (const lic of licenses.values()) {
              if (lic.stripeSubscriptionId === subId) {
                lic.graceUntil = graceUntil
                lic.updatedAt = new Date().toISOString()
              }
            }
          }
          return { success: true }
        },
        all: async <T = any>() => ({
          results: Array.from(licenses.values()) as T[],
        }),
      }),
    }),
  }

  return mock
}

/**
 * Helper to create a valid license for testing.
 */
export function makeLicense(overrides: Partial<License> = {}): License {
  return {
    id: 'test-id-' + Math.random().toString(36).slice(2),
    key: 'LR-TEST-AAAA-BBBB-CCCC',
    jwt: 'header.payload.signature',
    email: 'test@example.com',
    tier: 'pro',
    stripeCustomerId: 'cus_test123',
    stripeSubscriptionId: 'sub_test123',
    validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    graceUntil: null,
    serverFingerprint: null,
    lastHeartbeat: null,
    isActive: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}
