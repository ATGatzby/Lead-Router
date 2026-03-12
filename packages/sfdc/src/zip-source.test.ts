import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { zipSourcePackage } from './zip-source'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'

/**
 * Minimal ZIP parser using the Central Directory (at end of ZIP).
 * Archiver uses data descriptors so local file header sizes are 0.
 * The central directory has the correct sizes and offsets.
 */
function parseZipEntries(buf: Buffer): Map<string, string> {
  const { inflateRawSync } = require('node:zlib')
  const entries = new Map<string, string>()

  // Find End of Central Directory Record (EOCD): PK\x05\x06
  let eocdOffset = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) return entries

  const cdOffset = buf.readUInt32LE(eocdOffset + 16)
  const cdEntries = buf.readUInt16LE(eocdOffset + 10)
  let pos = cdOffset

  for (let i = 0; i < cdEntries; i++) {
    // Central directory file header: PK\x01\x02
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b || buf[pos + 2] !== 0x01 || buf[pos + 3] !== 0x02) break

    const compressionMethod = buf.readUInt16LE(pos + 10)
    const compressedSize = buf.readUInt32LE(pos + 20)
    const uncompressedSize = buf.readUInt32LE(pos + 24)
    const fileNameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localHeaderOffset = buf.readUInt32LE(pos + 42)
    const fileName = buf.toString('utf8', pos + 46, pos + 46 + fileNameLen)

    if (!fileName.endsWith('/') && compressedSize > 0) {
      // Read from local file header to get actual data offset
      const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26)
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen

      let content: string
      if (compressionMethod === 0) {
        content = buf.toString('utf8', dataStart, dataStart + compressedSize)
      } else if (compressionMethod === 8) {
        try {
          content = inflateRawSync(buf.subarray(dataStart, dataStart + compressedSize)).toString('utf8')
        } catch { content = '' }
      } else {
        content = ''
      }
      entries.set(fileName, content)
    }

    pos += 46 + fileNameLen + extraLen + commentLen
  }

  return entries
}

/**
 * Create a temporary SFDC source-format package directory for testing.
 */
function createTestPackage(opts?: {
  apiVersion?: string
  classes?: Record<string, string>
  permissionsets?: Record<string, string>
  namedCredentials?: Record<string, string>
  remoteSiteSettings?: Record<string, string>
  tabs?: Record<string, string>
  applications?: Record<string, string>
  triggers?: Record<string, string>
  objects?: Record<string, { meta?: string; fields?: Record<string, string> }>
  lwc?: Record<string, Record<string, string>>
}): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'zip-source-test-'))
  const defaultDir = join(tmpDir, 'force-app', 'main', 'default')

  // Write sfdx-project.json
  writeFileSync(
    join(tmpDir, 'sfdx-project.json'),
    JSON.stringify({ sourceApiVersion: opts?.apiVersion ?? '59.0' })
  )

  // Helper to create dir + files
  const writeFiles = (dirName: string, files: Record<string, string>) => {
    const dir = join(defaultDir, dirName)
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
  }

  if (opts?.classes) writeFiles('classes', opts.classes)
  if (opts?.permissionsets) writeFiles('permissionsets', opts.permissionsets)
  if (opts?.namedCredentials) writeFiles('namedCredentials', opts.namedCredentials)
  if (opts?.remoteSiteSettings) writeFiles('remoteSiteSettings', opts.remoteSiteSettings)
  if (opts?.tabs) writeFiles('tabs', opts.tabs)
  if (opts?.applications) writeFiles('applications', opts.applications)
  if (opts?.triggers) writeFiles('triggers', opts.triggers)

  // Objects with decomposed fields
  if (opts?.objects) {
    for (const [objName, objData] of Object.entries(opts.objects)) {
      const objDir = join(defaultDir, 'objects', objName)
      mkdirSync(objDir, { recursive: true })
      if (objData.meta) {
        writeFileSync(join(objDir, `${objName}.object-meta.xml`), objData.meta)
      }
      if (objData.fields) {
        const fieldsDir = join(objDir, 'fields')
        mkdirSync(fieldsDir, { recursive: true })
        for (const [fieldFile, fieldContent] of Object.entries(objData.fields)) {
          writeFileSync(join(fieldsDir, fieldFile), fieldContent)
        }
      }
    }
  }

  // LWC components (directories)
  if (opts?.lwc) {
    for (const [compName, files] of Object.entries(opts.lwc)) {
      const compDir = join(defaultDir, 'lwc', compName)
      mkdirSync(compDir, { recursive: true })
      for (const [fileName, content] of Object.entries(files)) {
        writeFileSync(join(compDir, fileName), content)
      }
    }
  }

  return tmpDir
}

describe('zipSourcePackage', () => {
  let tmpDirs: string[] = []

  // Cleanup after each test
  afterEach(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tmpDirs = []
  })

  function trackDir(dir: string): string {
    tmpDirs.push(dir)
    return dir
  }

  // ──────────────────────────────────────────────────────────────────
  // Permission Sets: meta-xml-only files must appear in package.xml
  // This was the key bug fix — files with only -meta.xml were skipped
  // ──────────────────────────────────────────────────────────────────

  describe('PermissionSet (meta-xml-only files)', () => {
    it('includes PermissionSet members in package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          permissionsets: {
            'LeadRouterAdmin.permissionset-meta.xml':
              '<?xml version="1.0" encoding="UTF-8"?><PermissionSet><label>Lead Router Admin</label></PermissionSet>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const entries = parseZipEntries(buf)
      const packageXml = entries.get('package.xml')

      expect(packageXml).toBeDefined()
      expect(packageXml).toContain('<members>LeadRouterAdmin</members>')
      expect(packageXml).toContain('<name>PermissionSet</name>')
    })

    it('includes the .permissionset-meta.xml file in the ZIP', async () => {
      const dir = trackDir(
        createTestPackage({
          permissionsets: {
            'LeadRouterAdmin.permissionset-meta.xml':
              '<?xml version="1.0" encoding="UTF-8"?><PermissionSet><label>Lead Router Admin</label></PermissionSet>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const entries = parseZipEntries(buf)

      expect(entries.has('permissionsets/LeadRouterAdmin.permissionset-meta.xml')).toBe(true)
    })

    it('handles multiple permission sets', async () => {
      const dir = trackDir(
        createTestPackage({
          permissionsets: {
            'LeadRouterAdmin.permissionset-meta.xml': '<PermissionSet/>',
            'LeadRouterUser.permissionset-meta.xml': '<PermissionSet/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const entries = parseZipEntries(buf)
      const packageXml = entries.get('package.xml')!

      expect(packageXml).toContain('<members>LeadRouterAdmin</members>')
      expect(packageXml).toContain('<members>LeadRouterUser</members>')
      expect(packageXml).toContain('<name>PermissionSet</name>')
    })
  })

  // ──────────────────────────────────────────────────────────────────
  // Apex Classes: both .cls and .cls-meta.xml files
  // ──────────────────────────────────────────────────────────────────

  describe('ApexClass', () => {
    it('includes class members from .cls files in package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          classes: {
            'RoutingEngineCallout.cls': 'public class RoutingEngineCallout {}',
            'RoutingEngineCallout.cls-meta.xml':
              '<?xml version="1.0" encoding="UTF-8"?><ApexClass><apiVersion>59.0</apiVersion></ApexClass>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const entries = parseZipEntries(buf)
      const packageXml = entries.get('package.xml')!

      expect(packageXml).toContain('<members>RoutingEngineCallout</members>')
      expect(packageXml).toContain('<name>ApexClass</name>')
      // Both files should be in the ZIP
      expect(entries.has('classes/RoutingEngineCallout.cls')).toBe(true)
      expect(entries.has('classes/RoutingEngineCallout.cls-meta.xml')).toBe(true)
    })

    it('deduplicates member names when both .cls and .cls-meta.xml exist', async () => {
      const dir = trackDir(
        createTestPackage({
          classes: {
            'Foo.cls': 'public class Foo {}',
            'Foo.cls-meta.xml': '<ApexClass/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      // Should only appear once (Set deduplicates)
      const matches = packageXml.match(/<members>Foo<\/members>/g)
      expect(matches).toHaveLength(1)
    })
  })

  // ──────────────────────────────────────────────────────────────────
  // Other meta-xml-only types
  // ──────────────────────────────────────────────────────────────────

  describe('NamedCredential (meta-xml-only)', () => {
    it('includes NamedCredential in package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          namedCredentials: {
            'RoutingEngine.namedCredential-meta.xml': '<NamedCredential/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<members>RoutingEngine</members>')
      expect(packageXml).toContain('<name>NamedCredential</name>')
    })
  })

  describe('RemoteSiteSetting (meta-xml-only)', () => {
    it('includes RemoteSiteSetting in package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          remoteSiteSettings: {
            'LeadRouterApp.remoteSite-meta.xml': '<RemoteSiteSetting/>',
            'LeadRouterEngine.remoteSite-meta.xml': '<RemoteSiteSetting/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<members>LeadRouterApp</members>')
      expect(packageXml).toContain('<members>LeadRouterEngine</members>')
      expect(packageXml).toContain('<name>RemoteSiteSetting</name>')
    })
  })

  describe('CustomTab (meta-xml-only)', () => {
    it('includes CustomTab in package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          tabs: {
            'Lead_Router_Setup.tab-meta.xml': '<CustomTab/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<members>Lead_Router_Setup</members>')
      expect(packageXml).toContain('<name>CustomTab</name>')
    })
  })

  describe('CustomApplication (meta-xml-only)', () => {
    it('includes CustomApplication in package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          applications: {
            'Lead_Router_Setup.app-meta.xml': '<CustomApplication/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<members>Lead_Router_Setup</members>')
      expect(packageXml).toContain('<name>CustomApplication</name>')
    })
  })

  describe('ApexTrigger', () => {
    it('includes ApexTrigger in package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          triggers: {
            'LeadTrigger.trigger': 'trigger LeadTrigger on Lead (after insert) {}',
            'LeadTrigger.trigger-meta.xml': '<ApexTrigger/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<members>LeadTrigger</members>')
      expect(packageXml).toContain('<name>ApexTrigger</name>')
    })
  })

  // ──────────────────────────────────────────────────────────────────
  // Objects: decomposed fields merged into single .object XML
  // ──────────────────────────────────────────────────────────────────

  describe('CustomObject (decomposed fields)', () => {
    it('merges object-meta.xml and field files into single .object XML', async () => {
      const dir = trackDir(
        createTestPackage({
          objects: {
            Routing_Settings__c: {
              meta:
                '<?xml version="1.0" encoding="UTF-8"?><CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"><label>Routing Settings</label></CustomObject>',
              fields: {
                'Engine_Endpoint__c.field-meta.xml':
                  '<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Engine_Endpoint__c</fullName><type>Url</type></CustomField>',
                'Webhook_Secret__c.field-meta.xml':
                  '<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Webhook_Secret__c</fullName><type>Text</type></CustomField>',
              },
            },
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const entries = parseZipEntries(buf)

      // Should have a merged .object file
      const objectXml = entries.get('objects/Routing_Settings__c.object')
      expect(objectXml).toBeDefined()

      // Should contain the object wrapper
      expect(objectXml).toContain('<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">')
      expect(objectXml).toContain('</CustomObject>')

      // Should contain the label from object-meta.xml
      expect(objectXml).toContain('<label>Routing Settings</label>')

      // Should contain field wrappers
      expect(objectXml).toContain('<fields>')
      expect(objectXml).toContain('</fields>')
      expect(objectXml).toContain('<fullName>Engine_Endpoint__c</fullName>')
      expect(objectXml).toContain('<fullName>Webhook_Secret__c</fullName>')
    })

    it('adds CustomObject members to package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          objects: {
            Routing_Settings__c: {
              meta: '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"/>',
              fields: {
                'Engine_Endpoint__c.field-meta.xml': '<CustomField/>',
              },
            },
            Route_Criteria__c: {
              meta: '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"/>',
              fields: {
                'Rule_Id__c.field-meta.xml': '<CustomField/>',
              },
            },
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<members>Route_Criteria__c</members>')
      expect(packageXml).toContain('<members>Routing_Settings__c</members>')
      expect(packageXml).toContain('<name>CustomObject</name>')
    })

    it('handles objects with fields but no object-meta.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          objects: {
            Test__c: {
              fields: {
                'Name__c.field-meta.xml':
                  '<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Name__c</fullName></CustomField>',
              },
            },
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const entries = parseZipEntries(buf)
      const objectXml = entries.get('objects/Test__c.object')

      expect(objectXml).toBeDefined()
      expect(objectXml).toContain('<fields>')
      expect(objectXml).toContain('<fullName>Name__c</fullName>')
    })

    it('sorts fields alphabetically', async () => {
      const dir = trackDir(
        createTestPackage({
          objects: {
            Test__c: {
              fields: {
                'Zebra__c.field-meta.xml':
                  '<?xml version="1.0" encoding="UTF-8"?><CustomField><fullName>Zebra__c</fullName></CustomField>',
                'Alpha__c.field-meta.xml':
                  '<?xml version="1.0" encoding="UTF-8"?><CustomField><fullName>Alpha__c</fullName></CustomField>',
              },
            },
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const objectXml = parseZipEntries(buf).get('objects/Test__c.object')!

      const alphaIdx = objectXml.indexOf('Alpha__c')
      const zebraIdx = objectXml.indexOf('Zebra__c')
      expect(alphaIdx).toBeLessThan(zebraIdx)
    })
  })

  // ──────────────────────────────────────────────────────────────────
  // package.xml generation
  // ──────────────────────────────────────────────────────────────────

  describe('package.xml generation', () => {
    it('generates correct XML structure with version', async () => {
      const dir = trackDir(
        createTestPackage({
          apiVersion: '61.0',
          classes: {
            'Foo.cls': 'public class Foo {}',
            'Foo.cls-meta.xml': '<ApexClass/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(packageXml).toContain('<Package xmlns="http://soap.sforce.com/2006/04/metadata">')
      expect(packageXml).toContain('<version>61.0</version>')
      expect(packageXml).toContain('</Package>')
    })

    it('sorts metadata types alphabetically', async () => {
      const dir = trackDir(
        createTestPackage({
          classes: {
            'Foo.cls': 'public class Foo {}',
            'Foo.cls-meta.xml': '<ApexClass/>',
          },
          permissionsets: {
            'Admin.permissionset-meta.xml': '<PermissionSet/>',
          },
          tabs: {
            'Setup.tab-meta.xml': '<CustomTab/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      const apexIdx = packageXml.indexOf('<name>ApexClass</name>')
      const tabIdx = packageXml.indexOf('<name>CustomTab</name>')
      const permIdx = packageXml.indexOf('<name>PermissionSet</name>')

      // ApexClass < CustomTab < PermissionSet (alphabetical)
      expect(apexIdx).toBeLessThan(tabIdx)
      expect(tabIdx).toBeLessThan(permIdx)
    })

    it('sorts members within each type alphabetically', async () => {
      const dir = trackDir(
        createTestPackage({
          classes: {
            'Zebra.cls': 'public class Zebra {}',
            'Zebra.cls-meta.xml': '<ApexClass/>',
            'Alpha.cls': 'public class Alpha {}',
            'Alpha.cls-meta.xml': '<ApexClass/>',
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      const alphaIdx = packageXml.indexOf('<members>Alpha</members>')
      const zebraIdx = packageXml.indexOf('<members>Zebra</members>')
      expect(alphaIdx).toBeLessThan(zebraIdx)
    })

    it('uses default API version 59.0 when sfdx-project.json is missing', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'zip-source-test-'))
      tmpDirs.push(tmpDir)
      const defaultDir = join(tmpDir, 'force-app', 'main', 'default', 'classes')
      mkdirSync(defaultDir, { recursive: true })
      writeFileSync(join(defaultDir, 'Foo.cls'), 'public class Foo {}')
      writeFileSync(join(defaultDir, 'Foo.cls-meta.xml'), '<ApexClass/>')
      // No sfdx-project.json

      const buf = await zipSourcePackage(tmpDir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<version>59.0</version>')
    })

    it('includes all metadata types from a full package', async () => {
      const dir = trackDir(
        createTestPackage({
          classes: {
            'MyClass.cls': 'public class MyClass {}',
            'MyClass.cls-meta.xml': '<ApexClass/>',
          },
          permissionsets: {
            'Admin.permissionset-meta.xml': '<PermissionSet/>',
          },
          namedCredentials: {
            'Engine.namedCredential-meta.xml': '<NamedCredential/>',
          },
          remoteSiteSettings: {
            'AppSite.remoteSite-meta.xml': '<RemoteSiteSetting/>',
          },
          tabs: {
            'Setup.tab-meta.xml': '<CustomTab/>',
          },
          applications: {
            'MyApp.app-meta.xml': '<CustomApplication/>',
          },
          objects: {
            Settings__c: {
              meta: '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"/>',
            },
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<name>ApexClass</name>')
      expect(packageXml).toContain('<name>PermissionSet</name>')
      expect(packageXml).toContain('<name>NamedCredential</name>')
      expect(packageXml).toContain('<name>RemoteSiteSetting</name>')
      expect(packageXml).toContain('<name>CustomTab</name>')
      expect(packageXml).toContain('<name>CustomApplication</name>')
      expect(packageXml).toContain('<name>CustomObject</name>')
    })
  })

  // ──────────────────────────────────────────────────────────────────
  // LWC components
  // ──────────────────────────────────────────────────────────────────

  describe('LightningComponentBundle (LWC)', () => {
    it('includes LWC component directories and adds to package.xml', async () => {
      const dir = trackDir(
        createTestPackage({
          lwc: {
            onboardingWizard: {
              'onboardingWizard.js': 'export default class OnboardingWizard {}',
              'onboardingWizard.html': '<template></template>',
              'onboardingWizard.js-meta.xml': '<LightningComponentBundle/>',
            },
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const entries = parseZipEntries(buf)
      const packageXml = entries.get('package.xml')!

      expect(packageXml).toContain('<members>onboardingWizard</members>')
      expect(packageXml).toContain('<name>LightningComponentBundle</name>')
    })
  })

  // ──────────────────────────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty package directory (no metadata types)', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'zip-source-test-'))
      tmpDirs.push(tmpDir)
      mkdirSync(join(tmpDir, 'force-app', 'main', 'default'), { recursive: true })
      writeFileSync(join(tmpDir, 'sfdx-project.json'), '{"sourceApiVersion":"59.0"}')

      const buf = await zipSourcePackage(tmpDir)
      const entries = parseZipEntries(buf)

      // Should still have package.xml
      expect(entries.has('package.xml')).toBe(true)
      const packageXml = entries.get('package.xml')!
      expect(packageXml).toContain('<version>59.0</version>')
      // No types
      expect(packageXml).not.toContain('<types>')
    })

    it('skips non-file entries in metadata type directories', async () => {
      // If there's a subdirectory inside classes/ it should be ignored
      const tmpDir = mkdtempSync(join(tmpdir(), 'zip-source-test-'))
      tmpDirs.push(tmpDir)
      const classesDir = join(tmpDir, 'force-app', 'main', 'default', 'classes')
      mkdirSync(classesDir, { recursive: true })
      writeFileSync(join(classesDir, 'Good.cls'), 'public class Good {}')
      mkdirSync(join(classesDir, 'SomeSubDir'), { recursive: true })
      writeFileSync(join(tmpDir, 'sfdx-project.json'), '{"sourceApiVersion":"59.0"}')

      const buf = await zipSourcePackage(tmpDir)
      const packageXml = parseZipEntries(buf).get('package.xml')!

      expect(packageXml).toContain('<members>Good</members>')
      // Subdirectory should not appear
      expect(packageXml).not.toContain('SomeSubDir')
    })

    it('ignores non-field-meta.xml files in object field directories', async () => {
      const dir = trackDir(
        createTestPackage({
          objects: {
            Test__c: {
              fields: {
                'Valid__c.field-meta.xml':
                  '<?xml version="1.0" encoding="UTF-8"?><CustomField><fullName>Valid__c</fullName></CustomField>',
                'README.txt': 'This should be ignored',
              },
            },
          },
        })
      )

      const buf = await zipSourcePackage(dir)
      const objectXml = parseZipEntries(buf).get('objects/Test__c.object')!

      expect(objectXml).toContain('<fullName>Valid__c</fullName>')
      expect(objectXml).not.toContain('README')
    })
  })
})
