import { loadMcpConfig } from './context'
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

  test('環境変数で指定したパスから設定を読み込める', async () => {
    const customPath = '/custom/path/mcp.json'
    process.env.MCP_CONFIG_PATH = customPath

    const accessSpy = vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined)
    const readSpy = vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(validConfig))

    const config = await loadMcpConfig()

    expect(readSpy).toHaveBeenCalledWith(customPath, 'utf-8')
    expect(config.servers).toHaveLength(1)
    expect(config.servers[0].name).toBe('test')
  })

  test('カレントディレクトリから設定を読み込める', async () => {
    const cwdPath = path.resolve(process.cwd(), '.roo/mcp.json')

    // 環境変数のパスは存在しないと仮定
    const accessSpy = vi.spyOn(fs, 'access')
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined)

    const readSpy = vi.spyOn(fs, 'readFile')
      .mockResolvedValueOnce(JSON.stringify(validConfig))

    const config = await loadMcpConfig()

    expect(readSpy).toHaveBeenCalledWith(cwdPath, 'utf-8')
    expect(config.servers).toHaveLength(1)
  })

  test('ホームディレクトリから設定を読み込める', async () => {
    const homePath = path.resolve(process.env.HOME || '', '.roo/mcp.json')

    // 環境変数とカレントディレクトリのパスは存在しないと仮定
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

  test('設定ファイルが見つからない場合はエラーを投げる', async () => {
    // すべてのパスで設定ファイルが見つからないと仮定
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'))

    await expect(loadMcpConfig()).rejects.toThrow('設定ファイルが見つかりません')
  })
})
