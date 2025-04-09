import { spawnMcpServers } from './mcpLauncher'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'

describe('spawnMcpServers', () => {
  const originalPath = process.env.PATH

  beforeEach(() => {
    // Ensure PATH is set for tests
    process.env.PATH = process.env.PATH || '/usr/local/bin:/usr/bin'
  })

  afterEach(() => {
    // Restore original PATH
    process.env.PATH = originalPath
  })

  test('initializes servers with correct configuration', async () => {
    const servers = [
      { name: 'mock', command: 'bun', args: ['foo.ts'], cwd: '/tmp' }
    ]
    const result = await spawnMcpServers(servers)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('mock')
  })

  test('merges PATH environment variables correctly', async () => {
    const serverPath = '/custom/bin'
    const servers = [{
      name: 'test',
      command: 'npx',
      args: [],
      cwd: '.',
      env: { PATH: serverPath }
    }]

    const result = await spawnMcpServers(servers)
    expect(result[0].process.spawnargs).toContain(
      expect.stringContaining(`${process.env.PATH}:${serverPath}`)
    )
  })

  test('preserves system PATH when server has no custom PATH', async () => {
    const systemPath = process.env.PATH || '/usr/local/bin:/usr/bin'
    const servers = [{
      name: 'test',
      command: 'npx',
      args: [],
      cwd: '.',
      env: { OTHER_VAR: 'value' }
    }]

    const result = await spawnMcpServers(servers)
    expect(result[0].process.spawnargs).toContain(
      expect.stringContaining(systemPath)
    )
  })
})
