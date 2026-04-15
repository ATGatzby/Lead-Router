import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface SshInstallConfig {
  host: string
  port: number
  username: string
  /** Absolute path to private key on local machine — not stored if password auth was used */
  privateKeyPath?: string
}

export interface InstallConfig {
  appUrl: string
  engineUrl: string
  /** Base domain (e.g. acme.com) — all subdomains derived from this */
  baseDomain?: string
  /** Public MCP HTTP server URL */
  mcpUrl?: string
  /** CRM type — 'salesforce' or 'hubspot' */
  crmType?: 'salesforce' | 'hubspot'
  /** Local directory where config files are written (./lead-routing/) */
  installDir: string
  /** Absolute path on the remote server (e.g. /root/lead-routing) */
  remoteDir: string
  /** SSH connection details for subsequent commands */
  ssh: SshInstallConfig
  dockerManaged: {
    db: boolean
    redis: boolean
  }
  /** Engine webhook secret — used for HMAC validation in SFDC callouts */
  engineWebhookSecret?: string
  /** License key — empty for free tier */
  licenseKey?: string
  /** License tier — 'free' or 'pro' */
  licenseTier: 'free' | 'pro'
  /** Whether the agent API + Langfuse integration is enabled */
  enableAgentApi?: boolean
  /** Public URL for the Langfuse dashboard */
  langfuseUrl?: string
  installedAt: string
  version: string
}

export function getConfigPath(dir: string): string {
  return join(dir, 'lead-routing.json')
}

export function readConfig(dir: string): InstallConfig | null {
  const path = getConfigPath(dir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as InstallConfig
  } catch {
    return null
  }
}

export function writeConfig(dir: string, config: InstallConfig): void {
  writeFileSync(getConfigPath(dir), JSON.stringify(config, null, 2), 'utf8')
}

export function findInstallDir(startDir = process.cwd()): string | null {
  const candidate = join(startDir, 'lead-routing.json')
  if (existsSync(candidate)) return startDir
  // Check dev directory first — takes precedence over prod when both exist
  const dev = join(startDir, 'lead-routing-dev', 'lead-routing.json')
  if (existsSync(dev)) return join(startDir, 'lead-routing-dev')
  const nested = join(startDir, 'lead-routing', 'lead-routing.json')
  if (existsSync(nested)) return join(startDir, 'lead-routing')
  return null
}
