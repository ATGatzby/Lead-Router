import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: mockFs.existsSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
}))

import { getConfigPath, readConfig, writeConfig, findInstallDir, type InstallConfig } from './config.js'

const sampleConfig: InstallConfig = {
  appUrl: 'https://leads.acme.com',
  engineUrl: 'https://engine.acme.com',
  installDir: '/home/user/lead-routing',
  remoteDir: '/root/lead-routing',
  ssh: {
    host: '1.2.3.4',
    port: 22,
    username: 'root',
  },
  dockerManaged: { db: true, redis: true },
  licenseTier: 'free',
  installedAt: '2026-01-01T00:00:00.000Z',
  version: '0.1.0',
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── getConfigPath ──────────────────────────────────────────────────────────

describe('getConfigPath', () => {
  it('returns correct path by joining dir with lead-routing.json', () => {
    expect(getConfigPath('/some/dir')).toBe('/some/dir/lead-routing.json')
  })
})

// ─── readConfig ─────────────────────────────────────────────────────────────

describe('readConfig', () => {
  it('parses valid JSON file', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(sampleConfig))

    const result = readConfig('/some/dir')
    expect(result).toEqual(sampleConfig)
    expect(mockFs.readFileSync).toHaveBeenCalledWith('/some/dir/lead-routing.json', 'utf8')
  })

  it('returns null for missing file', () => {
    mockFs.existsSync.mockReturnValue(false)

    const result = readConfig('/some/dir')
    expect(result).toBeNull()
    expect(mockFs.readFileSync).not.toHaveBeenCalled()
  })

  it('returns null for invalid JSON', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('not valid json {{{')

    const result = readConfig('/some/dir')
    expect(result).toBeNull()
  })
})

// ─── writeConfig ────────────────────────────────────────────────────────────

describe('writeConfig', () => {
  it('writes pretty-printed JSON', () => {
    writeConfig('/some/dir', sampleConfig)

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/some/dir/lead-routing.json',
      JSON.stringify(sampleConfig, null, 2),
      'utf8',
    )
  })
})

// ─── findInstallDir ─────────────────────────────────────────────────────────

describe('findInstallDir', () => {
  it('finds lead-routing.json in current dir', () => {
    mockFs.existsSync.mockImplementation((path: string) => {
      return path === '/work/lead-routing.json'
    })

    expect(findInstallDir('/work')).toBe('/work')
  })

  it('finds lead-routing.json in nested lead-routing/ subdir', () => {
    mockFs.existsSync.mockImplementation((path: string) => {
      if (path === '/work/lead-routing.json') return false
      if (path === '/work/lead-routing/lead-routing.json') return true
      return false
    })

    expect(findInstallDir('/work')).toBe('/work/lead-routing')
  })

  it('returns null if not found in either location', () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(findInstallDir('/work')).toBeNull()
  })
})

// ─── Agent API fields in InstallConfig ──────────────────────────────────────

describe('InstallConfig — agent API fields', () => {
  const configWithAgentApi: InstallConfig = {
    ...sampleConfig,
    enableAgentApi: true,
    langfuseUrl: 'https://evals.acme.com',
  }

  it('round-trips enableAgentApi and langfuseUrl through write/read', () => {
    let written = ''
    mockFs.writeFileSync.mockImplementation((_path: string, content: string) => {
      written = content
    })
    writeConfig('/some/dir', configWithAgentApi)

    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(written)
    const result = readConfig('/some/dir')

    expect(result?.enableAgentApi).toBe(true)
    expect(result?.langfuseUrl).toBe('https://evals.acme.com')
  })

  it('enableAgentApi defaults to undefined when not set', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(sampleConfig))

    const result = readConfig('/some/dir')
    expect(result?.enableAgentApi).toBeUndefined()
    expect(result?.langfuseUrl).toBeUndefined()
  })
})

// ─── baseDomain and mcpUrl fields ──────────────────────────────────────────

describe('InstallConfig — baseDomain and mcpUrl fields', () => {
  const configWithDomain: InstallConfig = {
    ...sampleConfig,
    baseDomain: 'acme.com',
    mcpUrl: 'https://mcp.acme.com',
  }

  it('round-trips baseDomain and mcpUrl through write/read', () => {
    let written = ''
    mockFs.writeFileSync.mockImplementation((_path: string, content: string) => {
      written = content
    })
    writeConfig('/some/dir', configWithDomain)

    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(written)
    const result = readConfig('/some/dir')

    expect(result?.baseDomain).toBe('acme.com')
    expect(result?.mcpUrl).toBe('https://mcp.acme.com')
  })

  it('baseDomain and mcpUrl default to undefined when not set', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(sampleConfig))

    const result = readConfig('/some/dir')
    expect(result?.baseDomain).toBeUndefined()
    expect(result?.mcpUrl).toBeUndefined()
  })
})
