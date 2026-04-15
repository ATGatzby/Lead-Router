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
  adminEmail: 'admin@acme.com',
  adminPassword: 'password123',
  internalApiKey: 'internal_api_key_here',
  licenseTier: 'free',
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

  it('default config includes all five expected services', () => {
    const out = renderDockerCompose({ managedDb: true, managedRedis: true })
    expect(out).toContain('  postgres:')
    expect(out).toContain('  redis:')
    expect(out).toContain('  web:')
    expect(out).toContain('  engine:')
    expect(out).toContain('  caddy:')
  })

  it('caddy service has correct port mappings for 80, 443, and 443/udp', () => {
    const out = renderDockerCompose({ managedDb: false, managedRedis: false })
    expect(out).toContain('"80:80"')
    expect(out).toContain('"443:443"')
    expect(out).toContain('"443:443/udp"')
  })

  it('caddy service does not have a marketing-site volume mount', () => {
    const out = renderDockerCompose({ managedDb: true, managedRedis: true })
    expect(out).not.toContain('marketing')
    expect(out).not.toContain('site')
  })

  it('caddy service depends on web and engine', () => {
    const out = renderDockerCompose({ managedDb: false, managedRedis: false })
    // Extract the caddy block
    const caddyStart = out.indexOf('  caddy:')
    const caddyBlock = out.slice(caddyStart)
    expect(caddyBlock).toContain('- web')
    expect(caddyBlock).toContain('- engine')
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

// ─── renderEnvWeb — Langfuse integration ─────────────────────────────────────

describe('renderEnvWeb — Langfuse integration', () => {
  it('includes Langfuse env vars when langfuseEnabled is true', () => {
    const out = renderEnvWeb({ ...baseWebConfig, langfuseEnabled: true })
    expect(out).toContain('LANGFUSE_ENABLED=true')
    expect(out).toContain('LANGFUSE_URL=http://langfuse:3000')
    expect(out).toContain('LANGFUSE_PUBLIC_KEY=')
    expect(out).toContain('LANGFUSE_SECRET_KEY=')
  })

  it('does not include Langfuse env vars when langfuseEnabled is false', () => {
    const out = renderEnvWeb({ ...baseWebConfig, langfuseEnabled: false })
    expect(out).not.toContain('LANGFUSE_ENABLED')
    expect(out).not.toContain('LANGFUSE_URL')
  })

  it('does not include Langfuse env vars when langfuseEnabled is undefined', () => {
    const out = renderEnvWeb(baseWebConfig)
    expect(out).not.toContain('LANGFUSE_ENABLED')
    expect(out).not.toContain('LANGFUSE_URL')
  })

  it('includes Langfuse keys when provided', () => {
    const out = renderEnvWeb({
      ...baseWebConfig,
      langfuseEnabled: true,
      langfusePublicKey: 'pk-lf-abc',
      langfuseSecretKey: 'sk-lf-xyz',
    })
    expect(out).toContain('LANGFUSE_PUBLIC_KEY=pk-lf-abc')
    expect(out).toContain('LANGFUSE_SECRET_KEY=sk-lf-xyz')
  })
})

// ─── renderDockerCompose — Langfuse service ──────────────────────────────────

describe('renderDockerCompose — Langfuse service', () => {
  it('includes langfuse service when managedLangfuse is true', () => {
    const out = renderDockerCompose({
      managedDb: true,
      managedRedis: true,
      managedLangfuse: true,
      langfuseUrl: 'https://evals.acme.com',
      langfuseSecret: 'secret123',
      langfuseSalt: 'salt123',
      dbPassword: 'testpw',
    })
    expect(out).toContain('  langfuse:')
    expect(out).toContain('langfuse/langfuse:2')
    expect(out).toContain('NEXTAUTH_URL: https://evals.acme.com')
    expect(out).toContain('NEXTAUTH_SECRET: secret123')
    expect(out).toContain('SALT: salt123')
    expect(out).toContain('TELEMETRY_ENABLED: "false"')
  })

  it('does not include langfuse service when managedLangfuse is false', () => {
    const out = renderDockerCompose({ managedDb: true, managedRedis: true, managedLangfuse: false })
    expect(out).not.toContain('  langfuse:')
    expect(out).not.toContain('langfuse/langfuse:2')
  })

  it('caddy depends on langfuse when managedLangfuse is true', () => {
    const out = renderDockerCompose({
      managedDb: true,
      managedRedis: true,
      managedLangfuse: true,
      langfuseUrl: 'https://evals.acme.com',
      langfuseSecret: 's',
      langfuseSalt: 's',
    })
    const caddyStart = out.indexOf('  caddy:')
    const caddyBlock = out.slice(caddyStart)
    expect(caddyBlock).toContain('- langfuse')
  })

  it('caddy does not depend on langfuse when managedLangfuse is false', () => {
    const out = renderDockerCompose({ managedDb: false, managedRedis: false })
    const caddyStart = out.indexOf('  caddy:')
    const caddyBlock = out.slice(caddyStart)
    expect(caddyBlock).not.toContain('- langfuse')
  })

  it('langfuse DATABASE_URL points to langfuse database', () => {
    const out = renderDockerCompose({
      managedDb: true,
      managedRedis: true,
      managedLangfuse: true,
      langfuseUrl: 'https://evals.acme.com',
      langfuseSecret: 's',
      langfuseSalt: 's',
      dbPassword: 'mydbpw',
    })
    expect(out).toContain('postgresql://leadrouting:mydbpw@postgres:5432/langfuse')
  })
})

// ─── renderCaddyfile — Langfuse block ────────────────────────────────────────

describe('renderCaddyfile — Langfuse block', () => {
  it('includes Langfuse site block when langfuseUrl is provided (Case A)', () => {
    const out = renderCaddyfile('https://leads.acme.com', 'https://engine.acme.com', 'https://evals.acme.com')
    expect(out).toContain('evals.acme.com {')
    expect(out).toContain('reverse_proxy langfuse:3000')
  })

  it('includes Langfuse site block when langfuseUrl is provided (Case B)', () => {
    const out = renderCaddyfile('https://leads.acme.com', 'https://leads.acme.com:3001', 'https://evals.acme.com')
    expect(out).toContain('evals.acme.com {')
    expect(out).toContain('reverse_proxy langfuse:3000')
  })

  it('does not include Langfuse block when langfuseUrl is undefined', () => {
    const out = renderCaddyfile('https://leads.acme.com', 'https://engine.acme.com')
    expect(out).not.toContain('langfuse')
  })

  it('does not include Langfuse block when langfuseUrl is empty string', () => {
    const out = renderCaddyfile('https://leads.acme.com', 'https://engine.acme.com', '')
    expect(out).not.toContain('langfuse')
  })
})

// ─── renderDockerCompose — MCP service ──────────────────────────────────────

describe('renderDockerCompose — MCP service', () => {
  it('includes mcp service when managedMcp is true', () => {
    const out = renderDockerCompose({
      managedDb: true,
      managedRedis: true,
      managedMcp: true,
      mcpWebhookSecret: 'ws123',
      mcpCrmType: 'salesforce',
    })
    expect(out).toContain('  mcp:')
    expect(out).toContain('ghcr.io/atgatzby/lead-routing-mcp:latest')
    expect(out).toContain('WEBHOOK_SECRET: ws123')
    expect(out).toContain('CRM_TYPE: salesforce')
    expect(out).toContain('PORT: "3100"')
    expect(out).toContain('TRANSPORT: http')
  })

  it('does not include mcp service when managedMcp is false', () => {
    const out = renderDockerCompose({ managedDb: true, managedRedis: true, managedMcp: false })
    expect(out).not.toContain('  mcp:')
    expect(out).not.toContain('lead-routing-mcp')
  })

  it('caddy depends on mcp when managedMcp is true', () => {
    const out = renderDockerCompose({
      managedDb: true,
      managedRedis: true,
      managedMcp: true,
    })
    const caddyStart = out.indexOf('  caddy:')
    const caddyBlock = out.slice(caddyStart)
    expect(caddyBlock).toContain('- mcp')
  })

  it('caddy does not depend on mcp when managedMcp is false', () => {
    const out = renderDockerCompose({ managedDb: false, managedRedis: false })
    const caddyStart = out.indexOf('  caddy:')
    const caddyBlock = out.slice(caddyStart)
    expect(caddyBlock).not.toContain('- mcp')
  })

  it('mcp service depends on web with service_healthy', () => {
    const out = renderDockerCompose({
      managedDb: true,
      managedRedis: true,
      managedMcp: true,
    })
    const mcpStart = out.indexOf('  mcp:')
    const mcpEnd = out.indexOf('\n  caddy:', mcpStart)
    const mcpBlock = out.slice(mcpStart, mcpEnd)
    expect(mcpBlock).toContain('depends_on:')
    expect(mcpBlock).toContain('web:')
    expect(mcpBlock).toContain('condition: service_healthy')
  })
})

// ─── renderCaddyfile — MCP block ────────────────────────────────────────────

describe('renderCaddyfile — MCP block', () => {
  it('includes MCP site block when mcpEnabled and mcpUrl are provided', () => {
    const out = renderCaddyfile({
      appUrl: 'https://app.acme.com',
      engineUrl: 'https://api.acme.com',
      mcpEnabled: true,
      mcpUrl: 'https://mcp.acme.com',
    })
    expect(out).toContain('mcp.acme.com {')
    expect(out).toContain('reverse_proxy mcp:3100')
  })

  it('does not include MCP block when mcpEnabled is false', () => {
    const out = renderCaddyfile({
      appUrl: 'https://app.acme.com',
      engineUrl: 'https://api.acme.com',
      mcpEnabled: false,
    })
    expect(out).not.toContain('mcp.')
    expect(out).not.toContain('reverse_proxy mcp:3100')
  })

  it('includes both Langfuse and MCP blocks when both enabled', () => {
    const out = renderCaddyfile({
      appUrl: 'https://app.acme.com',
      engineUrl: 'https://api.acme.com',
      langfuseUrl: 'https://evals.acme.com',
      mcpEnabled: true,
      mcpUrl: 'https://mcp.acme.com',
    })
    expect(out).toContain('evals.acme.com {')
    expect(out).toContain('reverse_proxy langfuse:3000')
    expect(out).toContain('mcp.acme.com {')
    expect(out).toContain('reverse_proxy mcp:3100')
  })
})

// ─── renderCaddyfile — baseDomain subdomain model ──────────────────────────

describe('renderCaddyfile — baseDomain subdomain model', () => {
  it('generates all 4 subdomain blocks for full agent API config', () => {
    const out = renderCaddyfile({
      appUrl: 'https://app.acme.com',
      engineUrl: 'https://api.acme.com',
      baseDomain: 'acme.com',
      langfuseUrl: 'https://evals.acme.com',
      mcpEnabled: true,
      mcpUrl: 'https://mcp.acme.com',
    })
    expect(out).toContain('app.acme.com {')
    expect(out).toContain('api.acme.com {')
    expect(out).toContain('evals.acme.com {')
    expect(out).toContain('mcp.acme.com {')
  })
})

// ─── renderEnvEngine ──────────────────────────────────────────────────────────

const baseEngineConfig = {
  databaseUrl: 'postgresql://u:p@postgres:5432/leadrouting',
  redisUrl: 'redis://redis:6379',
  engineWebhookSecret: 'webhook_secret_here',
  internalApiKey: 'internal_api_key_here',
  licenseTier: 'free',
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
