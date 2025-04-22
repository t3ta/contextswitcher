#!/usr/bin/env node
// Inspector機能を無効化するための環境変数 (ファイルの先頭で設定)
process.env.MCP_INSPECTOR_DISABLED = 'true'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
// Client と StdioClientTransport をインポート
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
// StdioServerParameters 型をインポート
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type ListToolsResult,
  ListToolsResultSchema,
  CallToolResultSchema // CallToolの結果スキーマもインポート
} from '@modelcontextprotocol/sdk/types.js'

import { loadMcpConfig, loadContextSwitcherSettings, type ContextSwitcherSettings } from './context.js'
import { spawnMcpServers, type LaunchedServer } from './mcpLauncher.js' // LaunchedServerをインポート

// 共通のロガー
const logger = {
  info: (...args: any[]) => console.error('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.error('[WARN]', ...args), // warnを追加
  debug: (...args: any[]) => console.error('[DEBUG]', ...args)
}

// サーバー名とツール名のマッピング (ツール名 -> サーバー名)
let toolToServerMap: Record<string, string> = {};
// 起動中のサーバープロセス情報 (サーバー名 -> LaunchedServer)
let runningServers: Record<string, LaunchedServer> = {};
// ContextSwitcherの設定情報 (デフォルト値で初期化)
let contextSwitcherSettings: ContextSwitcherSettings = {
  switchingEnabled: true,
  toolSuffix: '_cs'
};

// Serverインスタンスを遅延生成するための変数
let server: Server;

// --- Helper Function to Stop Running Servers ---
async function stopRunningServers() {
  const serverNames = Object.keys(runningServers);
  if (serverNames.length === 0) {
    logger.debug("No running servers to stop.");
    return;
  }

  logger.info("Stopping previously running MCP server processes...");
  const stopPromises = serverNames.map(name => {
    const serverInfo = runningServers[name];
    return new Promise<void>((resolve) => {
      if (serverInfo && serverInfo.process && !serverInfo.process.killed) {
        logger.debug(`Stopping process for server: ${name}`);
        serverInfo.process.kill('SIGTERM'); // Send SIGTERM first
        const timeout = setTimeout(() => {
          if (!serverInfo.process.killed) {
            logger.warn(`Process for server ${name} did not terminate gracefully, sending SIGKILL.`);
            serverInfo.process.kill('SIGKILL');
          }
          resolve();
        }, 2000); // 2 second timeout

        serverInfo.process.on('exit', (code, signal) => {
          clearTimeout(timeout);
          logger.debug(`Process for server ${name} exited with code ${code}, signal ${signal}.`);
          resolve();
        });
        serverInfo.process.on('error', (err) => { // エラーハンドリング追加
          clearTimeout(timeout);
          logger.error({ err }, `Error stopping process for server ${name}.`);
          resolve(); // エラーでも次に進む
        });
      } else {
        resolve(); // Already stopped or invalid
      }
    });
  });
  await Promise.allSettled(stopPromises);
  runningServers = {}; // Clear the record after attempting to stop all
  logger.info("Finished stopping server processes.");
}


// --- Helper Function to Fetch and Aggregate Tools ---
async function fetchAndAggregateTools(): Promise<{ tools: any[], resources: any[] }> {
  logger.info("Fetching tools from downstream servers...");
  const config = await loadMcpConfig();
  // config が null の場合も考慮
  if (!config || !config.servers || config.servers.length === 0) {
    logger.warn("No MCP server configurations found or config is empty. Returning empty list.");
    await stopRunningServers(); // 念のため既存サーバーを停止
    return { tools: [], resources: [] };
  }

  // ContextSwitcherの設定を読み込む
  contextSwitcherSettings = loadContextSwitcherSettings(config);

  await stopRunningServers(); // Stop existing servers before starting new ones

  const processes = await spawnMcpServers(config.servers);
  processes.forEach(p => {
    runningServers[p.name] = p;
  });

  toolToServerMap = {}; // Reset map
  const aggregatedTools: any[] = [];
  const aggregatedResources: any[] = [];

  // Helper to create StdioServerParameters from LaunchedServer (defined inside)
  const createStdioParams = (server: LaunchedServer): StdioServerParameters | null => {
    // LaunchedServer には McpServerConfig が含まれる前提
    if (!server || !server.command || !Array.isArray(server.args)) {
      logger.error({ server: server.name }, `Invalid config for '${server.name}': 'command' and 'args' are required.`);
      return null;
    }
    return {
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      stderr: 'pipe',
      env: {
        ...process.env,
        ...(server.env || {}),
        PATH: `${server.env?.PATH ? server.env.PATH + ':' : ''}${process.env.PATH || ''}`
      }
    };
  }

  const responses = await Promise.allSettled(processes.map(async serverProcess => {
    const stdioParams = createStdioParams(serverProcess);
    if (!stdioParams) {
      return { tools: [], resources: [] };
    }

    const transport = new StdioClientTransport(stdioParams);
    const client = new Client({
      name: `contextswitcher-${serverProcess.name}-client-list`,
      version: '0.1.0'
    });

    try {
      await client.connect(transport);
      const response = await client.listTools(); // Use helper method
      const tools = response.tools || [];
      const resources = response.resources || [];

      // Populate the map
      tools.forEach(tool => {
        if (tool.name) {
          if (toolToServerMap[tool.name]) {
            logger.warn(`Duplicate tool name "${tool.name}" found on server "${serverProcess.name}". Previous server: "${toolToServerMap[tool.name]}". Overwriting.`);
          }
          toolToServerMap[tool.name] = serverProcess.name;
        }
      });
      return { tools, resources };
    } catch (error) {
      logger.error({ err: error, server: serverProcess.name }, `MCP Error fetching tools/list`);
      return { tools: [], resources: [] };
    } finally {
      // Ensure close is called even if connect fails after transport creation
      await client.close().catch(closeErr => logger.error({ err: closeErr, server: serverProcess.name }, "Error closing client during finally block."));
      // Transport might need explicit closing if client.close doesn't handle it
      await transport.close?.().catch(closeErr => logger.error({ err: closeErr, server: serverProcess.name }, "Error closing transport during finally block."));
    }
  }));

  responses.forEach(result => {
    if (result.status === 'fulfilled') {
      const value = result.value as { tools: any[], resources: any[] };
      aggregatedTools.push(...(value.tools || []));
      aggregatedResources.push(...(value.resources || []));
    } else {
      logger.error({ err: result.reason }, `Failed to get tools/resources from one of the servers.`);
    }
  });

  logger.info(`Aggregated ${aggregatedTools.length} tools and ${aggregatedResources.length} resources.`);
  logger.debug("Tool to Server Map:", toolToServerMap);

  return {
    tools: aggregatedTools,
    resources: aggregatedResources
  }
}

// ツールリストハンドラー/ツール呼び出しハンドラー/エラーハンドリング/クリーンアップ関数/プロセス終了ハンドリングは変更なし

// クリーンアップ関数
async function cleanup() {
  try {
    await server.close()
    logger.info('Server connection closed')
  } catch (error) {
    logger.error('Error during cleanup:', error)
  }
}

// プロセス終了ハンドリング
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal, shutting down...')
  await cleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down...')
  await cleanup()
  process.exit(0)
})

// メイン処理
async function main() {
  try {
    // 起動時に一度ツールリストを取得してマップを初期化
    const { tools } = await fetchAndAggregateTools();

    // Serverインスタンスをここで生成し、capabilities.toolsに初期ツールリストをセット
    server = new Server(
      {
        name: 'contextswitcher',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: tools.reduce((acc, t) => (t.name ? { ...acc, [t.name]: t } : acc), {}),
          discovery: {
            title: "Context Switcher",
            description: "A lightweight MCP gateway for managing multiple AI agent contexts across projects and environments."
          }
        }
      }
    );

    // ハンドラー登録
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return await fetchAndAggregateTools();
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name: toolName, arguments: toolArgs } = request.params;
      logger.info({ toolName, toolArgs }, "Received tools/call request.");
      const targetServerName = toolToServerMap[toolName];
      if (!targetServerName) {
        logger.error(`Tool \"${toolName}\" not found in any connected server.`);
        throw new Error(`Tool \"${toolName}\" not found.`);
      }
      const targetServerProcess = runningServers[targetServerName];
      if (!targetServerProcess) {
        logger.error(`Server process \"${targetServerName}\" for tool \"${toolName}\" not found or not running.`);
        throw new Error(`Server process \"${targetServerName}\" not available.`);
      }
      const createStdioParams = (server: LaunchedServer): StdioServerParameters | null => {
        if (!server || !server.command || !Array.isArray(server.args)) {
          logger.error({ server: server.name }, `Invalid config for '${server.name}': 'command' and 'args' are required.`);
          return null;
        }
        return {
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          stderr: 'pipe',
          env: {
            ...process.env,
            ...(server.env || {}),
            PATH: `${server.env?.PATH ? server.env.PATH + ':' : ''}${process.env.PATH || ''}`
          }
        };
      }
      const stdioParams = createStdioParams(targetServerProcess);
      if (!stdioParams) {
        throw new Error(`Failed to create stdio parameters for server ${targetServerName}`);
      }
      const transport = new StdioClientTransport(stdioParams);
      const client = new Client({
        name: `contextswitcher-${targetServerName}-client-call`,
        version: '0.1.0'
      });
      try {
        await client.connect(transport);
        logger.info({ toolName, targetServerName }, `Forwarding tools/call request...`);
        const callRequest = {
          method: "tools/call",
          params: { name: toolName, arguments: toolArgs }
        } as const;
        const result = await client.request(callRequest, CallToolResultSchema);
        logger.info({ toolName, targetServerName }, `Received response from downstream server.`);
        return result;
      } catch (error) {
        logger.error({ err: error, toolName, targetServerName }, `Error forwarding tools/call request`);
        throw error;
      } finally {
        await client.close();
        logger.debug({ toolName, targetServerName }, `Closed connection for tools/call.`);
      }
    });
    server.onerror = (error) => {
      logger.error('Server error:', error)
    }

    const transport = new StdioServerTransport(process.stdin, process.stdout)
    await server.connect(transport)
    logger.info('MCP Server started')
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// 実行
main()
