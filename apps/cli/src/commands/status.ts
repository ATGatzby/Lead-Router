import { log } from '@clack/prompts'
import { execa } from 'execa'
import { findInstallDir } from '../utils/config.js'

export async function runStatus(): Promise<void> {
  const dir = findInstallDir()
  if (!dir) {
    log.error('No lead-routing.json found. Run `lead-routing init` first.')
    process.exit(1)
  }

  const result = await execa('docker', ['compose', 'ps'], {
    cwd: dir,
    stdio: 'inherit',
    reject: false,
  })

  if (result.exitCode !== 0) {
    log.error('Failed to get container status. Is Docker running?')
    process.exit(1)
  }
}
