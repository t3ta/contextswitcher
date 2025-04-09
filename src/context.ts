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
  // Define configuration file paths in order of priority
  const configPaths = [
    // 1. Path specified by environment variable
    process.env.MCP_CONFIG_PATH,
    // 2. .roo/mcp.json in current directory
    path.resolve(process.cwd(), '.roo/mcp.json'),
    // 3. .roo/mcp.json in home directory
    path.resolve(process.env.HOME || '', '.roo/mcp.json'),
  ].filter((p): p is string => p !== undefined)

  // Find first existing configuration file
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
    throw new Error('No configuration file found')
  }

  let raw: string
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read configuration file: ${error.message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw error // Keep original SyntaxError for invalid JSON
    }
    throw new Error(`Failed to parse configuration file: ${error.message}`)
  }

  // Validate configuration structure
  if (!parsed || typeof parsed !== 'object' || !('mcpServers' in parsed)) {
    throw new Error('Invalid configuration format')
  }

  const { mcpServers } = parsed as {
    mcpServers: Record<string, {
      command: string
      args: string[]
      cwd?: string
      env?: Record<string, string>
    }>
  }

  const servers: McpServerConfig[] = Object.entries(mcpServers).map(([name, cfg]) => ({
    name,
    command: cfg.command,
    args: cfg.args,
    cwd: cfg.cwd || process.cwd(),
    env: cfg.env
  }))

  return { servers }
}
