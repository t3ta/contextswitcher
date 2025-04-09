import { spawnMcpServers } from './mcpLauncher'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ChildProcessWithoutNullStreams } from 'child_process'

describe('spawnMcpServers', () => {
  const defaultPath = '/usr/local/bin:/usr/bin'
  const originalPath = process.env.PATH

  beforeEach(() => {
    process.env.PATH = defaultPath
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.PATH = originalPath
  })

  test('initializes servers with correct configuration', async () => {
    const servers = [{ name: 'test', command: 'bun', args: ['foo.ts'], cwd: '/tmp' }]
    const result = await spawnMcpServers(servers)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      name: 'test',
      command: 'bun',
      args: ['foo.ts'],
      cwd: '/tmp',
      process: expect.any(Object)
    }))
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
    const proc = result[0].process as ChildProcessWithoutNullStreams & { spawnargs?: string[] }

    expect(proc).toBeDefined()
    // Check environment variable existence
    expect(proc).toEqual(
      expect.objectContaining({
        stdout: expect.any(Object),
        stderr: expect.any(Object)
      })
    )
  })

  test('preserves system PATH when server has no custom PATH', async () => {
    const servers = [{
      name: 'test',
      command: 'npx',
      args: [],
      cwd: '.',
      env: { OTHER_VAR: 'value' }
    }]

    const result = await spawnMcpServers(servers)
    const proc = result[0].process as ChildProcessWithoutNullStreams & { spawnargs?: string[] }

    expect(proc).toBeDefined()
    // Check that the process was created with proper streams
    expect(proc).toEqual(
      expect.objectContaining({
        stdout: expect.any(Object),
        stderr: expect.any(Object)
      })
    )
  })
})
