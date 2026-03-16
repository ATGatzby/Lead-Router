import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function getCliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'))
    return pkg.version ?? '0.1.0'
  } catch {
    return '0.1.0'
  }
}
import { log } from '@clack/prompts'
import type { CollectedConfig } from './collect-config.js'
import type { SshConfig } from '../utils/ssh.js'
import { renderDockerCompose } from '../templates/docker-compose.js'
import { renderEnvWeb } from '../templates/env-web.js'
import { renderEnvEngine } from '../templates/env-engine.js'
import { renderCaddyfile } from '../templates/caddy.js'
import { writeConfig } from '../utils/config.js'

export interface GeneratedPaths {
  dir: string
  composeFile: string
  envWeb: string
  envEngine: string
}

export interface LicenseConfig {
  licenseKey?: string
  licenseTier: 'free' | 'pro'
}

export function generateFiles(cfg: CollectedConfig, sshCfg: SshConfig, license: LicenseConfig = { licenseTier: 'free' }): GeneratedPaths {
  const dir = join(process.cwd(), 'lead-routing')
  mkdirSync(dir, { recursive: true })

  // ENGINE_URL for Docker-internal communication (web container → engine container)
  const dockerEngineUrl = `http://engine:3001`

  // docker-compose.yml
  const composeContent = renderDockerCompose({
    managedDb: cfg.managedDb,
    managedRedis: cfg.managedRedis,
    dbPassword: cfg.dbPassword,
    redisPassword: cfg.redisPassword,
  })
  const composeFile = join(dir, 'docker-compose.yml')
  writeFileSync(composeFile, composeContent, 'utf8')
  log.success('Generated docker-compose.yml')

  // Caddyfile (auto-HTTPS via Let's Encrypt)
  const caddyfileContent = renderCaddyfile(cfg.appUrl, cfg.engineUrl)
  writeFileSync(join(dir, 'Caddyfile'), caddyfileContent, 'utf8')
  log.success('Generated Caddyfile')

  // .env.web
  const envWebContent = renderEnvWeb({
    appUrl: cfg.appUrl,
    engineUrl: dockerEngineUrl,
    publicEngineUrl: cfg.engineUrl,
    databaseUrl: cfg.databaseUrl,
    redisUrl: cfg.redisUrl,
    sessionSecret: cfg.sessionSecret,
    engineWebhookSecret: cfg.engineWebhookSecret,
    adminEmail: cfg.adminEmail,
    adminPassword: cfg.adminPassword,
    internalApiKey: cfg.internalApiKey,
    resendApiKey: cfg.resendApiKey || undefined,
    feedbackToEmail: cfg.feedbackToEmail || undefined,
    licenseKey: license.licenseKey,
    licenseTier: license.licenseTier,
  })
  const envWeb = join(dir, '.env.web')
  writeFileSync(envWeb, envWebContent, 'utf8')
  log.success('Generated .env.web')

  // .env.engine
  const envEngineContent = renderEnvEngine({
    databaseUrl: cfg.databaseUrl,
    redisUrl: cfg.redisUrl,
    engineWebhookSecret: cfg.engineWebhookSecret,
    internalApiKey: cfg.internalApiKey,
    licenseKey: license.licenseKey,
    licenseTier: license.licenseTier,
  })
  const envEngine = join(dir, '.env.engine')
  writeFileSync(envEngine, envEngineContent, 'utf8')
  log.success('Generated .env.engine')

  // lead-routing.json — persists install metadata + SSH connection details
  // for subsequent commands (deploy, logs, status, doctor)
  writeConfig(dir, {
    appUrl: cfg.appUrl,
    engineUrl: cfg.engineUrl,
    installDir: dir,
    remoteDir: sshCfg.remoteDir,
    ssh: {
      host: sshCfg.host,
      port: sshCfg.port,
      username: sshCfg.username,
      privateKeyPath: sshCfg.privateKeyPath,
      // password intentionally not stored
    },
    dockerManaged: {
      db: cfg.managedDb,
      redis: cfg.managedRedis,
    },
    engineWebhookSecret: cfg.engineWebhookSecret,
    licenseKey: license.licenseKey,
    licenseTier: license.licenseTier,
    installedAt: new Date().toISOString(),
    version: getCliVersion(),
  })
  log.success('Generated lead-routing.json')

  return { dir, composeFile, envWeb, envEngine }
}
