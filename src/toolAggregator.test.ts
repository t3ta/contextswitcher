import { describe, expect, test, vi } from 'vitest'
import { listToolsFromServers } from './toolAggregator'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

// Clientをモック化
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [], resources: [] }),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}))

describe('listToolsFromServers', () => {
  test('returns merged tools/list results from servers', async () => {
    const mockClient = new Client({} as any);
    mockClient.listTools = vi.fn()
      .mockResolvedValueOnce({
        tools: [{ name: 'tool1', description: 'Tool 1' }],
        resources: [{ id: 'resource1' }]
      })
      .mockResolvedValueOnce({
        tools: [{ name: 'tool2', description: 'Tool 2' }],
        resources: []
      });

    const servers = [
      {
        name: 'server1',
        command: 'node',
        args: ['server1.js'],
        cwd: '/path/to/server1',
        process: {} as any
      },
      {
        name: 'server2',
        command: 'node',
        args: ['server2.js'],
        cwd: '/path/to/server2',
        process: {} as any
      }
    ];

    const result = await listToolsFromServers(servers);

    expect(result.tools).toHaveLength(2);
    expect(result.resources).toHaveLength(1);
  });

  test('handles errors from servers gracefully', async () => {
    const mockClient = new Client({} as any);
    mockClient.listTools = vi.fn()
      .mockResolvedValueOnce({
        tools: [{ name: 'tool1', description: 'Tool 1' }],
        resources: []
      })
      .mockRejectedValueOnce(new Error('Connection failed'));

    const servers = [
      {
        name: 'server1',
        command: 'node',
        args: ['server1.js'],
        cwd: '/path/to/server1',
        process: {} as any
      },
      {
        name: 'server2',
        command: 'node',
        args: ['server2.js'],
        cwd: '/path/to/server2',
        process: {} as any
      }
    ];

    const result = await listToolsFromServers(servers);

    // エラーがあっても成功した方のツールは取得できる
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('tool1');
  });
})
