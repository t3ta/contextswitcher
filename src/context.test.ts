import { loadMcpConfig } from './context'
import { describe, expect, test } from 'vitest'

test('loads valid .roo/mcp.json', async () => {
  const config = await loadMcpConfig()
  expect(config.servers).toBeInstanceOf(Array)
  expect(config.servers.length).toBeGreaterThan(0)
})
