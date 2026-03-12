import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { zipSourcePackage } from './zip-source.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract filenames from ZIP central directory (works with data descriptors) */
function listZipEntries(buf: Buffer): string[] {
  const entries: string[] = []

  // Scan for central directory file headers (PK\x01\x02)
  for (let i = 0; i < buf.length - 46; i++) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x01 &&
      buf[i + 3] === 0x02
    ) {
      const nameLen = buf.readUInt16LE(i + 28)
      const name = buf.subarray(i + 46, i + 46 + nameLen).toString('utf8')
      entries.push(name)
    }
  }

  return entries
}

// ─── Test Setup ──────────────────────────────────────────────────────────────

let testDir: string

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), 'zip-source-test-'))

  // Create a minimal SFDC source-format package
  mkdirSync(join(testDir, 'force-app', 'main', 'default', 'classes'), { recursive: true })
  writeFileSync(join(testDir, 'force-app', 'main', 'default', 'classes', 'MyClass.cls'), 'public class MyClass {}')
  writeFileSync(
    join(testDir, 'force-app', 'main', 'default', 'classes', 'MyClass.cls-meta.xml'),
    '<?xml version="1.0"?><ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>59.0</apiVersion></ApexClass>'
  )
  writeFileSync(
    join(testDir, 'sfdx-project.json'),
    JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '59.0' })
  )
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('zipSourcePackage()', () => {
  it('returns a Buffer', async () => {
    const buf = await zipSourcePackage(testDir)
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('produces a valid ZIP file (starts with PK header)', async () => {
    const buf = await zipSourcePackage(testDir)
    expect(buf[0]).toBe(0x50) // P
    expect(buf[1]).toBe(0x4b) // K
  })

  it('includes package.xml in the ZIP', async () => {
    const buf = await zipSourcePackage(testDir)
    const entries = listZipEntries(buf)
    expect(entries).toContain('package.xml')
  })

  it('includes metadata-format class files under classes/', async () => {
    const buf = await zipSourcePackage(testDir)
    const entries = listZipEntries(buf)
    const classEntries = entries.filter(e => e.startsWith('classes/'))
    expect(classEntries.length).toBeGreaterThan(0)
  })

  it('includes Apex class files', async () => {
    const buf = await zipSourcePackage(testDir)
    const entries = listZipEntries(buf)
    expect(entries.some(e => e.endsWith('MyClass.cls'))).toBe(true)
    expect(entries.some(e => e.endsWith('MyClass.cls-meta.xml'))).toBe(true)
  })

  it('includes classes directory entries', async () => {
    const buf = await zipSourcePackage(testDir)
    const entries = listZipEntries(buf)
    // metadata-format: files are under classes/ (not force-app/main/default/classes/)
    expect(entries.some(e => e.startsWith('classes/'))).toBe(true)
  })
})
