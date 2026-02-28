import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '@clack/prompts'
import type { CollectedConfig } from './collect-config.js'
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
  adminSecret: string
}

export function generateFiles(cfg: CollectedConfig): GeneratedPaths {
  const dir = join(process.cwd(), 'lead-routing')
  mkdirSync(dir, { recursive: true })

  // ENGINE_URL for Docker-internal communication (web container → engine container)
  const dockerEngineUrl = `http://engine:3001`

  // docker-compose.yml
  const composeContent = renderDockerCompose({
    managedDb: cfg.managedDb,
    managedRedis: cfg.managedRedis,
    dbPassword: cfg.dbPassword,
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
    databaseUrl: cfg.databaseUrl,
    redisUrl: cfg.redisUrl,
    sfdcClientId: cfg.sfdcClientId,
    sfdcClientSecret: cfg.sfdcClientSecret,
    sfdcLoginUrl: cfg.sfdcLoginUrl,
    sessionSecret: cfg.sessionSecret,
    engineWebhookSecret: cfg.engineWebhookSecret,
    adminSecret: cfg.adminSecret,
    resendApiKey: cfg.resendApiKey || undefined,
    feedbackToEmail: cfg.feedbackToEmail || undefined,
  })
  const envWeb = join(dir, '.env.web')
  writeFileSync(envWeb, envWebContent, 'utf8')
  log.success('Generated .env.web')

  // .env.engine
  const envEngineContent = renderEnvEngine({
    databaseUrl: cfg.databaseUrl,
    redisUrl: cfg.redisUrl,
    sfdcClientId: cfg.sfdcClientId,
    sfdcClientSecret: cfg.sfdcClientSecret,
    sfdcLoginUrl: cfg.sfdcLoginUrl,
    engineWebhookSecret: cfg.engineWebhookSecret,
  })
  const envEngine = join(dir, '.env.engine')
  writeFileSync(envEngine, envEngineContent, 'utf8')
  log.success('Generated .env.engine')

  // lead-routing.json (persisted config for future commands)
  writeConfig(dir, {
    appUrl: cfg.appUrl,
    engineUrl: cfg.engineUrl,
    installDir: dir,
    dockerManaged: {
      db: cfg.managedDb,
      redis: cfg.managedRedis,
    },
    installedAt: new Date().toISOString(),
    version: '0.1.0',
  })
  log.success('Generated lead-routing.json')

  return { dir, composeFile, envWeb, envEngine, adminSecret: cfg.adminSecret }
}
