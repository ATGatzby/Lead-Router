import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Test the XML patching logic that sfdc-deploy-inline uses.
// The patchXml function is internal, so we reproduce it here for testing.

function patchXml(content: string, tag: string, value: string): string {
  const re = new RegExp(`(<${tag}>)[^<]*(</\\s*${tag}>)`, 'g')
  return content.replace(re, `$1${value}$2`)
}

// ─── patchXml ────────────────────────────────────────────────────────────────

describe('patchXml()', () => {
  it('replaces content between XML tags', () => {
    const xml = '<config><endpoint>https://old.example.com</endpoint></config>'
    const result = patchXml(xml, 'endpoint', 'https://new.example.com')
    expect(result).toBe('<config><endpoint>https://new.example.com</endpoint></config>')
  })

  it('handles empty tag content', () => {
    const xml = '<settings><url></url></settings>'
    const result = patchXml(xml, 'url', 'https://example.com')
    expect(result).toBe('<settings><url>https://example.com</url></settings>')
  })

  it('replaces all occurrences of the same tag', () => {
    const xml = '<root><url>a</url><url>b</url></root>'
    const result = patchXml(xml, 'url', 'c')
    expect(result).toBe('<root><url>c</url><url>c</url></root>')
  })

  it('preserves other tags', () => {
    const xml = '<root><name>Keep</name><url>Replace</url></root>'
    const result = patchXml(xml, 'url', 'New')
    expect(result).toContain('<name>Keep</name>')
    expect(result).toContain('<url>New</url>')
  })

  it('handles multiline XML', () => {
    const xml = `<NamedCredential>
  <endpoint>https://old.example.com</endpoint>
  <label>My Credential</label>
</NamedCredential>`
    const result = patchXml(xml, 'endpoint', 'https://new.example.com')
    expect(result).toContain('<endpoint>https://new.example.com</endpoint>')
    expect(result).toContain('<label>My Credential</label>')
  })

  it('handles tags with whitespace before closing', () => {
    const xml = '<root><description>old</  description></root>'
    const result = patchXml(xml, 'description', 'new')
    expect(result).toContain('<description>new</  description>')
  })
})

// ─── Package copy + patch integration ────────────────────────────────────────

describe('SFDC package patching', () => {
  let srcDir: string
  let destDir: string

  const namedCredXml = `<?xml version="1.0" encoding="UTF-8"?>
<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <endpoint>https://placeholder.example.com</endpoint>
    <label>RoutingEngine</label>
</NamedCredential>`

  const remoteSiteXml = `<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <url>https://placeholder.example.com</url>
    <description>Placeholder</description>
    <isActive>true</isActive>
</RemoteSiteSetting>`

  it('patches Named Credential endpoint URL', () => {
    const patched = patchXml(namedCredXml, 'endpoint', 'https://api.myapp.com')
    expect(patched).toContain('<endpoint>https://api.myapp.com</endpoint>')
    expect(patched).toContain('<label>RoutingEngine</label>')
  })

  it('patches Remote Site Setting URL', () => {
    const patched = patchXml(remoteSiteXml, 'url', 'https://engine.myapp.com')
    expect(patched).toContain('<url>https://engine.myapp.com</url>')
  })

  it('patches Remote Site Setting description', () => {
    let patched = patchXml(remoteSiteXml, 'url', 'https://engine.myapp.com')
    patched = patchXml(patched, 'description', 'Lead Router Engine endpoint')
    expect(patched).toContain('<description>Lead Router Engine endpoint</description>')
  })

  it('preserves isActive flag after patching', () => {
    const patched = patchXml(remoteSiteXml, 'url', 'https://new.example.com')
    expect(patched).toContain('<isActive>true</isActive>')
  })
})
