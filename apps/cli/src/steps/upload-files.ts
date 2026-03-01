import { join } from 'node:path'
import { spinner } from '@clack/prompts'
import type { SshConnection } from '../utils/ssh.js'

/**
 * Upload the locally-generated config files to the remote server via SFTP.
 *
 * @param ssh        Active SSH connection
 * @param localDir   Local lead-routing/ directory (e.g. /Users/customer/project/lead-routing)
 * @param remoteDir  Resolved absolute path on server (e.g. /root/lead-routing)
 */
export async function uploadFiles(
  ssh: SshConnection,
  localDir: string,
  remoteDir: string
): Promise<void> {
  const s = spinner()
  s.start('Uploading config files to server')

  try {
    // Ensure the remote directory exists
    await ssh.mkdir(remoteDir)

    const filenames = [
      'docker-compose.yml',
      'Caddyfile',
      '.env.web',
      '.env.engine',
      'lead-routing.json',
    ]

    await ssh.upload(
      filenames.map((f) => ({
        local: join(localDir, f),
        remote: `${remoteDir}/${f}`,
      }))
    )

    s.stop(`Config files uploaded to ${remoteDir}`)
  } catch (err) {
    s.stop('File upload failed')
    throw err
  }
}
