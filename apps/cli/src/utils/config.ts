import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface InstallConfig {
  appUrl: string
  engineUrl: string
  installDir: string
  dockerManaged: {
    db: boolean
    redis: boolean
  }
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
  const nested = join(startDir, 'lead-routing', 'lead-routing.json')
  if (existsSync(nested)) return join(startDir, 'lead-routing')
  return null
}
