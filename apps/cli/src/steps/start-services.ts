import { spinner, log } from '@clack/prompts'
import type { SshConnection } from '../utils/ssh.js'

/**
 * Pull images and start Docker Compose services on the remote server via SSH.
 *
 * For fresh installs: wipes any existing postgres volume so the new DB password
 * (generated during config) is accepted. PostgreSQL ignores POSTGRES_PASSWORD
 * on subsequent starts when the data directory already exists — wiping ensures
 * the credentials in docker-compose.yml and DATABASE_URL stay in sync.
 */
export async function startServices(ssh: SshConnection, remoteDir: string): Promise<void> {
  await wipeStalePostgresVolume(ssh, remoteDir)
  await pullImages(ssh, remoteDir)
  await startContainers(ssh, remoteDir)
  await waitForPostgres(ssh, remoteDir)
}

/**
 * If a postgres_data volume already exists from a previous (possibly failed) init run,
 * bring compose down with -v so it is removed. This prevents POSTGRES_PASSWORD being
 * silently ignored on subsequent starts, which would cause authentication failures.
 */
async function wipeStalePostgresVolume(ssh: SshConnection, remoteDir: string): Promise<void> {
  // Derive the project name Docker Compose uses for volume prefixing.
  // Default is the directory name of the compose file (e.g. "lead-routing").
  const dirName = remoteDir.split('/').filter(Boolean).pop() ?? 'lead-routing'
  const volumeName = `${dirName}_postgres_data`

  const { code } = await ssh.execSilent(`docker volume inspect ${volumeName}`)
  if (code !== 0) {
    // Volume doesn't exist — fresh install, nothing to wipe.
    return
  }

  const s = spinner()
  s.start('Removing existing database volume for clean install')
  try {
    await ssh.exec('docker compose down -v --remove-orphans', remoteDir)
    s.stop('Old volumes removed — database will be initialised fresh')
  } catch {
    s.stop('Could not remove old volumes — proceeding anyway')
    log.warn(
      'If migrations fail with "authentication error", remove the postgres_data volume manually:\n' +
        `  ssh into your server and run: docker volume rm ${volumeName}`
    )
  }
}

async function pullImages(ssh: SshConnection, remoteDir: string): Promise<void> {
  const s = spinner()
  s.start('Pulling Docker images on server (this may take a few minutes)')
  try {
    await ssh.exec('docker compose pull', remoteDir)
    s.stop('Images pulled successfully')
  } catch {
    s.stop('Could not pull images from registry — using local images if available')
    log.warn(
      'Registry pull failed. If images are available on the server locally, setup will continue.'
    )
  }
}

async function startContainers(ssh: SshConnection, remoteDir: string): Promise<void> {
  const s = spinner()
  s.start('Starting services')
  try {
    await ssh.exec('docker compose up -d --remove-orphans', remoteDir)
    s.stop('Services started')
  } catch (err) {
    s.stop('Failed to start services')
    throw err
  }
}

async function waitForPostgres(ssh: SshConnection, remoteDir: string): Promise<void> {
  const s = spinner()
  s.start('Waiting for PostgreSQL to be ready')

  // Phase 1: wait for postgres to be ready inside the container (fast path).
  const maxAttempts = 24 // 24 × 2.5s = 60s
  let containerReady = false
  for (let i = 0; i < maxAttempts; i++) {
    const { code } = await ssh.execSilent(
      'docker compose exec -T postgres pg_isready -U leadrouting',
      remoteDir
    )
    if (code === 0) {
      containerReady = true
      break
    }
    s.message(`Waiting for PostgreSQL (${i + 1}/${maxAttempts})`)
    await sleep(2500)
  }

  if (!containerReady) {
    s.stop('PostgreSQL readiness check timed out — continuing anyway')
    log.warn('PostgreSQL may not be fully ready. If migrations fail, try `lead-routing deploy`.')
    return
  }

  // Phase 2: verify the HOST-side TCP port binding (127.0.0.1:5432) is accepting
  // connections. This is what the SSH tunnel actually forwards to. Container-internal
  // pg_isready can pass before Docker's host port mapping is fully active on fresh starts.
  for (let j = 0; j < 8; j++) {
    // Try nc (netcat) first — available on most Ubuntu/Debian VPS.
    // Fall back to bash /dev/tcp builtin if nc is missing.
    const { code } = await ssh.execSilent(
      "nc -z 127.0.0.1 5432 2>/dev/null || bash -c 'echo > /dev/tcp/127.0.0.1/5432' 2>/dev/null"
    )
    if (code === 0) {
      s.stop('PostgreSQL is ready')
      return
    }
    s.message(`Waiting for PostgreSQL host port (${j + 1}/8)`)
    await sleep(1000)
  }

  // Port binding check failed — proceed anyway (pg_isready passed, so postgres is up).
  s.stop('PostgreSQL is ready')
  log.warn('Host TCP port check timed out — tunnel may have issues. Proceeding anyway.')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
