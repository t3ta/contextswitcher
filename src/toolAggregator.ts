import { LaunchedServer } from './mcpLauncher.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ListToolsRequestSchema, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js'

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
};

export type ToolListResponse = {
  tools: any[]
  resources: any[]
}

// Helper to create StdioServerParameters from LaunchedServer
function createStdioParams(server: LaunchedServer): StdioServerParameters | null {
  if (!server || !server.command || !Array.isArray(server.args)) {
    logger.error({ server: server.name }, `Invalid config for '${server.name}': 'command' and 'args' are required.`);
    return null;
  }
  return {
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    stderr: 'pipe', // デフォルトはpipe
    env: {
      ...process.env,
      ...(server.env || {}),
      PATH: process.env.PATH || server.env?.PATH || '',
    }
  };
}


export async function listToolsFromServers(servers: LaunchedServer[]): Promise<ToolListResponse> { // 戻り値を単一オブジェクトに
  const requests = servers.map(async (server) => {
    const stdioParams = createStdioParams(server);
    if (!stdioParams) {
      return { tools: [], resources: [] }; // エラー時は空を返す
    }

    const transport = new StdioClientTransport(stdioParams)
    const client = new Client({
      name: `contextswitcher-${server.name}-client`,
      version: '0.1.0'
    })

    try {
      // logger.debug({ server: server.name }, `Connecting to MCP server...`);
      await client.connect(transport)
      // logger.debug({ server: server.name }, `Connected. Listing tools...`);

      const response = await client.listTools()
      // logger.debug({ server: server.name, toolCount: response.tools?.length }, `Tools listed.`);

      return {
        tools: response.tools || [],
        resources: response.resources || []
      }
    } catch (error) {
      logger.error({ err: error, server: server.name }, `MCP Error`);
      return { tools: [], resources: [] }; // エラー時は空を返す
    } finally {
      // logger.debug({ server: server.name }, `Closing MCP client connection...`);
      await client.close()
      // logger.debug({ server: server.name }, `MCP client connection closed.`);
    }
  })

  const results = await Promise.allSettled(requests)

  // allSettledの結果を集約
  const aggregatedTools: any[] = [];
  const aggregatedResources: any[] = [];
  results.forEach(result => {
    if (result.status === 'fulfilled') {
      const value = result.value as ToolListResponse; // 型アサーションを追加
      aggregatedTools.push(...(value.tools || []));
      aggregatedResources.push(...(value.resources || []));
    } else {
      logger.error({ err: result.reason }, `Failed to get tools/resources from one of the servers.`);
    }
  });

  return { tools: aggregatedTools, resources: aggregatedResources };
}
