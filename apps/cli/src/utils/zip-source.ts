import { join } from 'node:path'
import archiver from 'archiver'

/**
 * Create a ZIP buffer of the SFDC source-format package directory.
 * Includes force-app/ and sfdx-project.json for Source Deploy API.
 */
export async function zipSourcePackage(packageDir: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const archive = archiver('zip', { zlib: { level: 9 } })

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)

    // Add force-app directory
    archive.directory(join(packageDir, 'force-app'), 'force-app')

    // Add sfdx-project.json
    archive.file(join(packageDir, 'sfdx-project.json'), {
      name: 'sfdx-project.json',
    })

    archive.finalize()
  })
}
