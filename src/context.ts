import fs from 'fs/promises'
import path from 'path'

export type McpServerConfig = {
  name: string
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export type McpConfig = {
  servers: McpServerConfig[]
}

export async function loadMcpConfig(): Promise<McpConfig> {
  // 設定ファイルの候補パスを定義
  const configPaths = [
    // 1. 環境変数で指定されたパス
    process.env.MCP_CONFIG_PATH,
    // 2. カレントディレクトリの.roo/mcp.json
    path.resolve(process.cwd(), '.roo/mcp.json'),
    // 3. ホームディレクトリの.roo/mcp.json
    path.resolve(process.env.HOME || '', '.roo/mcp.json'),
  ].filter((p): p is string => p !== undefined)

  // 存在する最初の設定ファイルを探す
  let configPath: string | undefined
  for (const p of configPaths) {
    try {
      await fs.access(p)
      configPath = p
      break
    } catch {
      continue
    }
  }

  if (!configPath) {
    throw new Error('設定ファイルが見つかりません。以下のパスを確認してください：\n' + configPaths.join('\n'))
  }

  const raw = await fs.readFile(configPath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    mcpServers: Record<string, {
      command: string
      args: string[]
      cwd?: string
      env?: Record<string, string>
    }>
  }

  const servers: McpServerConfig[] = Object.entries(parsed.mcpServers).map(([name, cfg]) => ({
    name,
    command: cfg.command,
    args: cfg.args,
    cwd: cfg.cwd || process.cwd(),
    env: cfg.env
  }))

  return { servers }
}
