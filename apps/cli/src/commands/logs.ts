import { log } from '@clack/prompts'
import { execa } from 'execa'
import { findInstallDir } from '../utils/config.js'

const VALID_SERVICES = ['web', 'engine', 'postgres', 'redis'] as const
type Service = (typeof VALID_SERVICES)[number]

export async function runLogs(service: string = 'engine'): Promise<void> {
  if (!VALID_SERVICES.includes(service as Service)) {
    log.error(`Unknown service "${service}". Valid options: ${VALID_SERVICES.join(', ')}`)
    process.exit(1)
  }

  const dir = findInstallDir()
  if (!dir) {
    log.error('No lead-routing.json found. Run `lead-routing init` first.')
    process.exit(1)
  }

  console.log(`\nStreaming logs for ${service} (Ctrl+C to stop)...\n`)

  // Stream logs — pass stdio through to terminal
  const child = execa('docker', ['compose', 'logs', '-f', '--tail=100', service], {
    cwd: dir,
    stdio: 'inherit',
    reject: false,
  })

  await child
}
