import { spinner, log } from '@clack/prompts'
import { execa } from 'execa'
import { run } from '../utils/exec.js'

export async function startServices(dir: string): Promise<void> {
  // Try to pull latest images from the registry.
  // If the pull fails (images not yet published, no network, etc.) we fall
  // back to whatever is available locally — useful during development.
  await pullImages(dir)

  // Start all services
  await run('docker', ['compose', 'up', '-d', '--remove-orphans'], {
    label: 'Starting services',
    cwd: dir,
  })

  // Wait for postgres to be ready (up to 60s)
  await waitForPostgres(dir)
}

async function pullImages(dir: string): Promise<void> {
  const s = spinner()
  s.start('Pulling Docker images (this may take a few minutes)')
  try {
    await execa('docker', ['compose', 'pull'], { cwd: dir, reject: true })
    s.stop('Images pulled successfully')
  } catch {
    s.stop('Could not pull images from registry — using local images if available')
    log.warn(
      'Registry pull failed. If you have built the images locally, setup will continue.\n' +
        '  To build locally: docker build -f apps/engine/Dockerfile -t ghcr.io/lead-routing/engine:latest .\n' +
        '                    docker build -f apps/web/Dockerfile    -t ghcr.io/lead-routing/web:latest .'
    )
  }
}

async function waitForPostgres(dir: string): Promise<void> {
  const s = spinner()
  s.start('Waiting for PostgreSQL to be ready')

  const maxAttempts = 24 // 24 × 2.5s = 60s
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await execa(
        'docker',
        ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'leadrouting'],
        { cwd: dir, reject: false }
      )
      if (result.exitCode === 0) {
        s.stop('PostgreSQL is ready')
        return
      }
    } catch {
      // not yet ready
    }
    await sleep(2500)
  }

  s.stop('PostgreSQL readiness check timed out — continuing anyway')
  log.warn('PostgreSQL may not be fully ready. If migrations fail, try `lead-routing deploy` again.')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
