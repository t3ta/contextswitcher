import { loadMcpConfig, loadContextSwitcherSettings, type ContextSwitcherSettings } from './context'
import { describe, expect, test, vi } from 'vitest'
import fs from 'fs/promises'
import path from 'path'

describe('loadMcpConfig', () => {
  const validConfig = {
    mcpServers: {
      test: {
        command: 'npx',
        args: ['-y', '@test/server'],
      }
    }
  }

  test('loads configuration from environment variable path', async () => {
    const customPath = '/custom/path/mcp.json'
    process.env.MCP_CONFIG_PATH = customPath

    const accessSpy = vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined)
    const readSpy = vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(validConfig))

    const config = await loadMcpConfig()

    expect(readSpy).toHaveBeenCalledWith(customPath, 'utf-8')
    expect(config.servers).toHaveLength(1)
    expect(config.servers[0].name).toBe('test')
  })

  test('loads configuration from current directory', async () => {
    const cwdPath = path.resolve(process.cwd(), '.roo/mcp.json')

    // Assume environment path doesn't exist
    const accessSpy = vi.spyOn(fs, 'access')
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined)

    const readSpy = vi.spyOn(fs, 'readFile')
      .mockResolvedValueOnce(JSON.stringify(validConfig))

    const config = await loadMcpConfig()

    expect(readSpy).toHaveBeenCalledWith(cwdPath, 'utf-8')
    expect(config.servers).toHaveLength(1)
  })

  test('loads configuration from home directory', async () => {
    const homePath = path.resolve(process.env.HOME || '', '.roo/mcp.json')

    // Assume environment and current directory paths don't exist
    const accessSpy = vi.spyOn(fs, 'access')
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined)

    const readSpy = vi.spyOn(fs, 'readFile')
      .mockResolvedValueOnce(JSON.stringify(validConfig))

    const config = await loadMcpConfig()

    expect(readSpy).toHaveBeenCalledWith(homePath, 'utf-8')
    expect(config.servers).toHaveLength(1)
  })

  test('throws error when no configuration file is found', async () => {
    // Assume no configuration files exist
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'))

    await expect(loadMcpConfig()).rejects.toThrow('No configuration file found')
  })

  test('throws error when configuration file is invalid JSON', async () => {
    // Assume file exists but contains invalid JSON
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    vi.spyOn(fs, 'readFile').mockResolvedValue('invalid json content')

    await expect(loadMcpConfig()).rejects.toThrow(SyntaxError)
  })

  test('throws error when configuration file has invalid schema', async () => {
    // Assume file exists but has wrong structure
    const invalidConfig = {
      wrongKey: {
        test: {
          command: 'npx'
        }
      }
    }

    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(invalidConfig))

    await expect(loadMcpConfig()).rejects.toThrow('Invalid configuration format')
  })
})

describe('loadContextSwitcherSettings', () => {
  test('returns default settings when contextSwitcher config is not found', () => {
    const config = {
      servers: [
        {
          name: 'server1',
          command: 'node',
          args: ['server.js'],
          cwd: '/path/to/server'
        }
      ]
    };

    const settings = loadContextSwitcherSettings(config);

    // デフォルト値の確認
    expect(settings.switchingEnabled).toBe(true);
    expect(settings.toolSuffix).toBe('_cs');
  });

  test('loads settings from contextSwitcher server config', () => {
    const config = {
      servers: [
        {
          name: 'contextswitcher',
          command: 'node',
          args: ['cli.js'],
          cwd: '/path/to/switcher',
          env: {
            SWITCHING_ENABLED: 'false',
            TOOL_SUFFIX: '_custom'
          }
        }
      ]
    };

    const settings = loadContextSwitcherSettings(config);

    // カスタム設定が読み込まれることを確認
    expect(settings.switchingEnabled).toBe(false);
    expect(settings.toolSuffix).toBe('_custom');
  });

  test('handles partial contextSwitcher settings', () => {
    const config = {
      servers: [
        {
          name: 'contextswitcher',
          command: 'node',
          args: ['cli.js'],
          cwd: '/path/to/switcher',
          env: {
            // SWITCHING_ENABLEDは指定なし
            TOOL_SUFFIX: '_partial'
          }
        }
      ]
    };

    const settings = loadContextSwitcherSettings(config);

    // 一部のみカスタム設定が読み込まれることを確認
    expect(settings.switchingEnabled).toBe(true); // デフォルト値
    expect(settings.toolSuffix).toBe('_partial'); // カスタム値
  });
})
