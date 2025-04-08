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
  const configPath = path.resolve(process.cwd(), '.roo/mcp.json')
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
