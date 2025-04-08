import { spawnMcpServers } from './mcpLauncher'
import { test, expect } from 'vitest'

test('spawns MCP servers with correct args', async () => {
  const servers = [
    { name: 'mock', command: 'bun', args: ['foo.ts'], cwd: '/tmp' }
  ]
  const result = await spawnMcpServers(servers)
  expect(result.length).toBe(1)
  expect(result[0].name).toBe('mock')
})
