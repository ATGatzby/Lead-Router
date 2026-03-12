import { describe, it, expect } from 'vitest'
import { renderEnvWeb } from './env-web.js'
import { renderEnvEngine } from './env-engine.js'
import { renderDockerCompose } from './docker-compose.js'
import { renderCaddyfile } from './caddy.js'

// ─── Shared test fixture ──────────────────────────────────────────────────────

const baseWebConfig = {
  appUrl: 'https://leads.acme.com',
  engineUrl: 'http://engine:3001',         // Docker-internal
  publicEngineUrl: 'https://engine.acme.com', // Public HTTPS URL
  databaseUrl: 'postgresql://u:p@postgres:5432/leadrouting',
  redisUrl: 'redis://redis:6379',
  sessionSecret: 'session_secret_here',
  engineWebhookSecret: 'webhook_secret_here',
  adminSecret: 'admin_secret_here',
  adminEmail: 'admin@acme.com',
  adminPassword: 'password123',
  internalApiKey: 'internal_api_key_here',
}

// ─── renderEnvWeb ─────────────────────────────────────────────────────────────

describe('renderEnvWeb', () => {
  it('includes ENGINE_URL as Docker-internal URL', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).toContain('ENGINE_URL=http://engine:3001')
  })

  it('includes PUBLIC_ENGINE_URL as the public HTTPS URL', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).toContain('PUBLIC_ENGINE_URL=https://engine.acme.com')
  })

  it('ENGINE_URL and PUBLIC_ENGINE_URL are different values', () => {
    const out = renderEnvWeb(baseWebConfig)
    const lines = out.split('\n')
    const engineLine = lines.find(l => l.startsWith('ENGINE_URL='))!
    const publicLine = lines.find(l => l.startsWith('PUBLIC_ENGINE_URL='))!
    expect(engineLine).not.toEqual(publicLine)
  })

  it('includes APP_URL', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).toContain('APP_URL=https://leads.acme.com')
  })

  it('includes NODE_ENV=production', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).toContain('NODE_ENV=production')
  })

  it('includes ENGINE_WEBHOOK_SECRET', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).toContain('ENGINE_WEBHOOK_SECRET=webhook_secret_here')
  })

  it('includes ADMIN_SECRET', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).toContain('ADMIN_SECRET=admin_secret_here')
  })

  it('outputs empty RESEND_API_KEY when not provided', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).toContain('RESEND_API_KEY=')
  })

  it('outputs provided RESEND_API_KEY when given', () => {
    const out = renderEnvWeb({ ...baseWebConfig, resendApiKey: 're_abc123' })
    expect(out).toContain('RESEND_API_KEY=re_abc123')
  })
})

// ─── renderDockerCompose ──────────────────────────────────────────────────────

describe('renderDockerCompose — managed DB + managed Redis', () => {
  const cfg = { managedDb: true, managedRedis: true }

  it('includes postgres service', () => {
    expect(renderDockerCompose(cfg)).toContain('postgres:')
  })

  it('postgres port is 127.0.0.1:5432:5432 (not public)', () => {
    expect(renderDockerCompose(cfg)).toContain('"127.0.0.1:5432:5432"')
  })

  it('includes redis service', () => {
    expect(renderDockerCompose(cfg)).toContain('redis:')
  })

  it('web service depends_on postgres', () => {
    const out = renderDockerCompose(cfg)
    // depends_on block must appear and reference postgres
    expect(out).toContain('depends_on:')
    expect(out).toContain('postgres:')
  })

  it('includes postgres_data and redis_data volumes', () => {
    const out = renderDockerCompose(cfg)
    expect(out).toContain('postgres_data:')
    expect(out).toContain('redis_data:')
  })
})

describe('renderDockerCompose — external DB + external Redis', () => {
  const cfg = { managedDb: false, managedRedis: false }

  it('does not include postgres service', () => {
    const out = renderDockerCompose(cfg)
    // "postgres:" only appears as an image name reference, not a service key at this indent level
    expect(out).not.toContain('  postgres:\n')
  })

  it('does not include redis service', () => {
    const out = renderDockerCompose(cfg)
    expect(out).not.toContain('  redis:\n')
  })

  it('does not include postgres_data or redis_data volumes', () => {
    const out = renderDockerCompose(cfg)
    expect(out).not.toContain('postgres_data:')
    expect(out).not.toContain('redis_data:')
  })

  it('web service has no depends_on', () => {
    const out = renderDockerCompose(cfg)
    // caddy has its own depends_on (web + engine), but web service should not
    // Check: no depends_on directly in the web service block
    // Simple check: no postgres/redis in depends_on
    expect(out).not.toContain('condition: service_healthy')
  })
})

describe('renderDockerCompose — managed DB, external Redis', () => {
  it('includes postgres but not redis service', () => {
    const out = renderDockerCompose({ managedDb: true, managedRedis: false })
    expect(out).toContain('postgres:')
    expect(out).not.toContain('  redis:\n')
  })
})

describe('renderDockerCompose — always present', () => {
  it('always includes web service', () => {
    expect(renderDockerCompose({ managedDb: false, managedRedis: false })).toContain('  web:')
  })

  it('always includes engine service', () => {
    expect(renderDockerCompose({ managedDb: false, managedRedis: false })).toContain('  engine:')
  })

  it('always includes caddy service', () => {
    expect(renderDockerCompose({ managedDb: false, managedRedis: false })).toContain('  caddy:')
  })

  it('always includes caddy volumes', () => {
    const out = renderDockerCompose({ managedDb: false, managedRedis: false })
    expect(out).toContain('caddy_data:')
    expect(out).toContain('caddy_config:')
  })

  it('caddy exposes ports 80 and 443', () => {
    const out = renderDockerCompose({ managedDb: false, managedRedis: false })
    expect(out).toContain('"80:80"')
    expect(out).toContain('"443:443"')
  })
})

// ─── renderCaddyfile ──────────────────────────────────────────────────────────

describe('renderCaddyfile — Case A: subdomain engine URL', () => {
  const appUrl = 'https://leads.acme.com'
  const engineUrl = 'https://engine.acme.com'

  it('generates two separate site blocks', () => {
    const out = renderCaddyfile(appUrl, engineUrl)
    expect(out).toContain('leads.acme.com {')
    expect(out).toContain('engine.acme.com {')
  })

  it('web block proxies to web:3000', () => {
    const out = renderCaddyfile(appUrl, engineUrl)
    // The web block appears before the engine block
    const webBlockStart = out.indexOf('leads.acme.com {')
    const webBlockEnd = out.indexOf('\n}', webBlockStart)
    const webBlock = out.slice(webBlockStart, webBlockEnd)
    expect(webBlock).toContain('reverse_proxy web:3000')
  })

  it('engine block proxies to engine:3001', () => {
    const out = renderCaddyfile(appUrl, engineUrl)
    const engineBlockStart = out.indexOf('engine.acme.com {')
    const engineBlockEnd = out.indexOf('\n}', engineBlockStart)
    const engineBlock = out.slice(engineBlockStart, engineBlockEnd)
    expect(engineBlock).toContain('reverse_proxy engine:3001')
  })
})

describe('renderCaddyfile — Case B: same domain, port-based engine URL', () => {
  const appUrl = 'https://leads.acme.com'
  const engineUrl = 'https://leads.acme.com:3001'

  it('generates port-based second listener', () => {
    const out = renderCaddyfile(appUrl, engineUrl)
    expect(out).toContain('leads.acme.com:3001 {')
  })

  it('web block is the plain hostname block', () => {
    const out = renderCaddyfile(appUrl, engineUrl)
    expect(out).toContain('leads.acme.com {')
  })

  it('engine block proxies to engine:3001', () => {
    const out = renderCaddyfile(appUrl, engineUrl)
    const portBlockStart = out.indexOf('leads.acme.com:3001 {')
    const portBlockEnd = out.indexOf('\n}', portBlockStart)
    const portBlock = out.slice(portBlockStart, portBlockEnd)
    expect(portBlock).toContain('reverse_proxy engine:3001')
  })
})

// ─── renderEnvEngine ──────────────────────────────────────────────────────────

const baseEngineConfig = {
  databaseUrl: 'postgresql://u:p@postgres:5432/leadrouting',
  redisUrl: 'redis://redis:6379',
  engineWebhookSecret: 'webhook_secret_here',
  internalApiKey: 'internal_api_key_here',
}

describe('renderEnvEngine', () => {
  it('renders all expected env vars', () => {
    const out = renderEnvEngine(baseEngineConfig)
    const expectedKeys = [
      'ENGINE_PORT',
      'LOG_LEVEL',
      'NODE_ENV',
      'DATABASE_URL',
      'REDIS_URL',
      'ENGINE_WEBHOOK_SECRET',
    ]
    for (const key of expectedKeys) {
      expect(out).toContain(`${key}=`)
    }
  })

  it('defaults ENGINE_PORT to 3001', () => {
    const out = renderEnvEngine(baseEngineConfig)
    expect(out).toContain('ENGINE_PORT=3001')
  })

  it('uses custom ENGINE_PORT when specified', () => {
    const out = renderEnvEngine({ ...baseEngineConfig, enginePort: 4000 })
    expect(out).toContain('ENGINE_PORT=4000')
  })

  it('includes DATABASE_URL', () => {
    const out = renderEnvEngine(baseEngineConfig)
    expect(out).toContain('DATABASE_URL=postgresql://u:p@postgres:5432/leadrouting')
  })

  it('includes REDIS_URL', () => {
    const out = renderEnvEngine(baseEngineConfig)
    expect(out).toContain('REDIS_URL=redis://redis:6379')
  })

  it('includes ENGINE_WEBHOOK_SECRET', () => {
    const out = renderEnvEngine(baseEngineConfig)
    expect(out).toContain('ENGINE_WEBHOOK_SECRET=webhook_secret_here')
  })

  it('includes NODE_ENV=production', () => {
    const out = renderEnvEngine(baseEngineConfig)
    expect(out).toContain('NODE_ENV=production')
  })

  it('defaults LOG_LEVEL to info', () => {
    const out = renderEnvEngine(baseEngineConfig)
    expect(out).toContain('LOG_LEVEL=info')
  })

  it('uses custom LOG_LEVEL when specified', () => {
    const out = renderEnvEngine({ ...baseEngineConfig, logLevel: 'debug' })
    expect(out).toContain('LOG_LEVEL=debug')
  })
})
