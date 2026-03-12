import { join } from 'node:path'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import archiver from 'archiver'

/**
 * Source-format directory name → Metadata API type name
 *
 * NOTE: This file is duplicated in packages/sfdc/src/zip-source.ts for use by the web app.
 * The CLI keeps its own copy because tsup bundles everything inline and cannot resolve
 * workspace package imports at build time.
 */
const META_TYPE_MAP: Record<string, string> = {
  applications: 'CustomApplication',
  classes: 'ApexClass',
  triggers: 'ApexTrigger',
  lwc: 'LightningComponentBundle',
  permissionsets: 'PermissionSet',
  namedCredentials: 'NamedCredential',
  remoteSiteSettings: 'RemoteSiteSetting',
  tabs: 'CustomTab',
}

/**
 * Create a ZIP buffer in **Metadata API format** from a source-format package.
 *
 * Converts from:  force-app/main/default/classes/Foo.cls
 * To:             classes/Foo.cls       (flat, metadata-format)
 *
 * Objects are merged from decomposed source format into single .object XML files.
 * A package.xml manifest is generated automatically.
 */
export async function zipSourcePackage(packageDir: string): Promise<Buffer> {
  const forceAppDefault = join(packageDir, 'force-app', 'main', 'default')

  // Read API version from sfdx-project.json
  let apiVersion = '59.0'
  try {
    const proj = JSON.parse(readFileSync(join(packageDir, 'sfdx-project.json'), 'utf8'))
    if (proj.sourceApiVersion) apiVersion = proj.sourceApiVersion
  } catch {
    // Use default
  }

  // Track members for package.xml
  const members = new Map<string, Set<string>>()
  const addMember = (type: string, name: string) => {
    if (!members.has(type)) members.set(type, new Set())
    members.get(type)!.add(name)
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const archive = archiver('zip', { zlib: { level: 9 } })

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)

    // ── 1. Simple types: just move from force-app/main/default/<type>/ → <type>/
    for (const [dirName, metaType] of Object.entries(META_TYPE_MAP)) {
      const srcDir = join(forceAppDefault, dirName)
      if (!existsSync(srcDir)) continue

      const entries = readdirSync(srcDir, { withFileTypes: true })

      for (const entry of entries) {
        if (dirName === 'lwc' && entry.isDirectory()) {
          // LWC: add entire directory
          addMember(metaType, entry.name)
          archive.directory(join(srcDir, entry.name), `${dirName}/${entry.name}`)
        } else if (entry.isFile()) {
          archive.file(join(srcDir, entry.name), { name: `${dirName}/${entry.name}` })
          // Track member name (strip -meta.xml suffix and extension)
          if (!entry.name.endsWith('-meta.xml')) {
            const memberName = entry.name.replace(/\.[^.]+$/, '')
            addMember(metaType, memberName)
          }
        }
      }
    }

    // ── 2. Objects: merge decomposed source files into single .object XML
    const objectsDir = join(forceAppDefault, 'objects')
    if (existsSync(objectsDir)) {
      for (const objEntry of readdirSync(objectsDir, { withFileTypes: true })) {
        if (!objEntry.isDirectory()) continue
        const objName = objEntry.name
        addMember('CustomObject', objName)

        const objDir = join(objectsDir, objName)
        const objectXml = mergeObjectXml(objDir, objName, apiVersion)
        archive.append(Buffer.from(objectXml, 'utf8'), {
          name: `objects/${objName}.object`,
        })
      }
    }

    // ── 3. Generate and add package.xml
    const packageXml = generatePackageXml(members, apiVersion)
    archive.append(Buffer.from(packageXml, 'utf8'), { name: 'package.xml' })

    archive.finalize()
  })
}

/**
 * Merge decomposed object source files into a single .object XML.
 * Reads the object-meta.xml + all field XMLs and combines them.
 */
function mergeObjectXml(objDir: string, objName: string, apiVersion: string): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">',
  ]

  // Read object-level metadata
  const objMetaPath = join(objDir, `${objName}.object-meta.xml`)
  if (existsSync(objMetaPath)) {
    const content = readFileSync(objMetaPath, 'utf8')
    // Extract inner elements (between <CustomObject> tags)
    const inner = content
      .replace(/<\?xml[^?]*\?>\s*/g, '')
      .replace(/<CustomObject[^>]*>/g, '')
      .replace(/<\/CustomObject>/g, '')
      .trim()
    if (inner) lines.push(inner)
  }

  // Read all field definitions
  const fieldsDir = join(objDir, 'fields')
  if (existsSync(fieldsDir)) {
    for (const fieldFile of readdirSync(fieldsDir).sort()) {
      if (!fieldFile.endsWith('.field-meta.xml')) continue
      const content = readFileSync(join(fieldsDir, fieldFile), 'utf8')
      // Extract the <fields> element content, wrap in <fields>
      const inner = content
        .replace(/<\?xml[^?]*\?>\s*/g, '')
        .replace(/<CustomField[^>]*>/g, '')
        .replace(/<\/CustomField>/g, '')
        .trim()
      if (inner) {
        lines.push('    <fields>')
        lines.push(`        ${inner}`)
        lines.push('    </fields>')
      }
    }
  }

  lines.push('</CustomObject>')
  return lines.join('\n')
}

/**
 * Generate package.xml manifest.
 */
function generatePackageXml(members: Map<string, Set<string>>, apiVersion: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
  ]

  for (const [metaType, names] of [...members.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push('    <types>')
    for (const name of [...names].sort()) {
      lines.push(`        <members>${name}</members>`)
    }
    lines.push(`        <name>${metaType}</name>`)
    lines.push('    </types>')
  }

  lines.push(`    <version>${apiVersion}</version>`)
  lines.push('</Package>')
  return lines.join('\n')
}
