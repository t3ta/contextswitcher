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
  CallToolResultSchema, // CallToolの結果スキーマもインポート
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import fs from 'fs/promises'
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

// サーバーの初期化

// context_switchのリクエストとレスポンススキーマを定義
// context_switchはサフィックスなしで登録する
const ContextSwitchMethodSchema = z.literal('context_switch')  // サフィックスなしのみ対応
const ContextSwitchParamsSchema = z.object({
  configPath: z.string()
})

const ContextSwitchRequestSchema = z.object({
  method: ContextSwitchMethodSchema,
  params: ContextSwitchParamsSchema
})

// 結果スキーマを外部からも参照できるようexport
export const ContextSwitchResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string()
    })
  ),
  metadata: z.object({
    success: z.boolean(),
    toolCount: z.number().optional()
  }).optional()
})

const server = new Server(
  {
    name: 'contextswitcher',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {
        // context_switchツールの登録 (サフィックスなし)
        'context_switch': {
          description: 'コンテキスト（MCPサーバー群）を切り替えるツール。指定された設定ファイルに基づいて使用可能なツールセットを動的に変更します。',
          parameters: {
            type: 'object',
            properties: {
              configPath: {
                type: 'string',
                description: '使用する設定ファイルのパス'
              }
            },
            required: ['configPath']
          },
          inputSchema: {
            type: 'object',
            properties: {
              configPath: {
                type: 'string'
              }
            },
            required: ['configPath']
          },
          outputSchema: {
            type: 'object',
            properties: {
              success: {
                type: 'boolean'
              },
              message: {
                type: 'string'
              },
              toolCount: {
                type: 'number'
              }
            },
            required: ['success', 'message']
          }
        }
      },
      discovery: {
        title: "Context Switcher",
        description: "A lightweight MCP gateway for managing multiple AI agent contexts across projects and environments."
      }
    }
    // debug: null は無効なオプションなので削除
  }
)

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

      // ここでのmapを削除（addSuffixToToolName関数内で実装するため）
      // tools.forEach(tool => {
      //   if (tool.name) {
      //     if (toolToServerMap[tool.name]) {
      //       logger.warn(`Duplicate tool name "${tool.name}" found on server "${serverProcess.name}". Previous server: "${toolToServerMap[tool.name]}". Overwriting.`);
      //     }
      //     toolToServerMap[tool.name] = serverProcess.name;
      //   }
      // });
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

  // ツール名にサフィックスを追加する関数
  function addSuffixToToolName(tool: any, serverName: string): any {
    const suffix = contextSwitcherSettings.toolSuffix;

    if (!tool || typeof tool !== 'object' || !tool.name || typeof tool.name !== 'string') {
      return tool;
    }

    // すでにサフィックスが付いていたら追加しない
    if (tool.name.endsWith(suffix)) {
      return tool;
    }

    // context_switchはサフィックスを付けない特別扱い
    if (tool.name === 'context_switch') {
      // 元のツール名をマッピングに追加
      if (toolToServerMap[tool.name]) {
        logger.warn(`Duplicate tool name "${tool.name}" found on server "${serverName}". Previous server: "${toolToServerMap[tool.name]}". Overwriting.`);
      }
      toolToServerMap[tool.name] = serverName;
      return tool;
    }

    // サフィックスを追加したコピーを返す
    // 元のツール名をマッピングに追加
    if (toolToServerMap[tool.name]) {
      logger.warn(`Duplicate tool name "${tool.name}" found on server "${serverName}". Previous server: "${toolToServerMap[tool.name]}". Overwriting.`);
    }
    toolToServerMap[tool.name] = serverName;

    return {
      ...tool,
      name: `${tool.name}${suffix}`
    };
  }

  responses.forEach(result => {
    if (result.status === 'fulfilled') {
      const value = result.value as { tools: any[], resources: any[] };

      // サーバー名を取得するため、対応するprocessを探す
      const serverProcess = processes.find(p => {
        // findでprocessesからserverProcessを特定する処理
        // value内にserverNameのような識別子がないため、
        // 何らかの方法で対応するprocessを特定する必要がある
        // ここでは簡易的に最初のprocessとしておく
        return true;
      });

      const serverName = serverProcess ? serverProcess.name : 'unknown';

      // ツール名にサフィックスを追加
      const toolsWithSuffix = (value.tools || []).map(tool =>
        addSuffixToToolName(tool, serverName)
      );

      aggregatedTools.push(...toolsWithSuffix);
      aggregatedResources.push(...(value.resources || []));
    } else {
      logger.error({ err: result.reason }, `Failed to get tools/resources from one of the servers.`);
    }
  });

  logger.info(`Aggregated ${aggregatedTools.length} tools and ${aggregatedResources.length} resources.`);
  logger.debug("Tool to Server Map:", toolToServerMap);

  // 自身のツール (context_switch) を追加 - サフィックスなしで登録
  const ownTool = {
    name: 'context_switch',  // サフィックスなしで登録
    description: 'コンテキスト（MCPサーバー群）を切り替えるツール。指定された設定ファイルに基づいて使用可能なツールセットを動的に変更します。',
    parameters: {
      type: 'object',
      properties: {
        configPath: {
          type: 'string',
          description: '使用する設定ファイルのパス'
        }
      },
      required: ['configPath']
    },
    inputSchema: {
      type: 'object',
      properties: {
        configPath: {
          type: 'string'
        }
      },
      required: ['configPath']
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['text']
              },
              text: {
                type: 'string'
              }
            },
            required: ['type', 'text']
          }
        },
        metadata: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean'
            },
            toolCount: {
              type: 'number'
            }
          },
          required: ['success']
        }
      },
      required: ['content']
    }
  };

  aggregatedTools.push(ownTool);

  // context_switchツールは特別なツールなので、runningServersには登録しない
  // 代わりに、toolToServerMapにマッピングだけ追加する
  // このツールは特別なハンドリングをするので、実際のサーバープロセスは不要

  // 自前ツールをマッピング
  toolToServerMap['context_switch'] = 'contextswitcher';

  return {
    tools: aggregatedTools,
    resources: aggregatedResources
  }
}

// ツールリストハンドラー (関数を呼び出すだけ)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // 毎回最新のツールリストを取得してマップを更新
  return await fetchAndAggregateTools();
})

// context_switchリクエストを処理する関数
async function processContextSwitchRequest(params: any): Promise<any> {
  const { configPath } = params;

  // 切り替え機能が無効化されていないかチェック
  if (!contextSwitcherSettings.switchingEnabled) {
    logger.warn(`Context switching is disabled. Request for ${configPath} rejected.`);
    // MCP形式に合わせて戻り値形式を変更
    return {
      content: [{
        type: "text",
        text: "Context switching is disabled in configuration"
      }],
      metadata: {
        success: false,
        toolCount: 0
      }
    };
  }

  try {
    // 設定ファイルの存在確認
    await fs.access(configPath);
    logger.info(`Switching context to ${configPath}`);

    // 環境変数を更新して再起動トリガー
    process.env.MCP_CONFIG_PATH = configPath;
    const result = await fetchAndAggregateTools();

    logger.info(`Context switched successfully to ${configPath}. Found ${result.tools.length} tools.`);
    // MCP形式に合わせて戻り値形式を変更
    return {
      content: [{
        type: "text",
        text: `Successfully switched to context: ${configPath}`
      }],
      metadata: {
        success: true,
        toolCount: result.tools.length
      }
    };
  } catch (error) {
    logger.error(`Failed to switch context to ${configPath}:`, error);
    // MCP形式に合わせて戻り値形式を変更
    return {
      content: [{
        type: "text",
        text: `Failed to switch context: ${error.message}`
      }],
      metadata: {
        success: false,
        toolCount: 0
      }
    };
  }
}

// context_switchハンドラー
server.setRequestHandler(ContextSwitchRequestSchema, async (request) => {
  return await processContextSwitchRequest(request.params);
});

// ツール呼び出しハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  let { name: toolName, arguments: toolArgs } = request.params;
  logger.info({ toolName, toolArgs }, "Received tools/call request.");

  // ツール名からサフィックスを除去（存在する場合）
  const suffix = contextSwitcherSettings.toolSuffix;
  if (toolName.endsWith(suffix)) {
    toolName = toolName.slice(0, -suffix.length);
    logger.debug(`Removed suffix from tool name: ${request.params.name} -> ${toolName}`);
  }

  // context_switchツールの場合は特別処理
  // このハンドラとは別のハンドラで処理するので、ここでは早期リターン
  if (toolName === 'context_switch') {
    logger.info('Detected context_switch tool call, will be handled by dedicated handler');

    try {
      // 直接処理関数を呼び出す（サーバープロセスのチェックをスキップ）
      const result = await processContextSwitchRequest(toolArgs);
      return result;
    } catch (error) {
      logger.error({ err: error }, `Error handling context_switch request`);
      throw error;
    }
  }

  // toolNameに対応するサーバー名を探す
  const targetServerName = toolToServerMap[toolName];
  if (!targetServerName) {
    logger.error(`Tool "${toolName}" not found in any connected server.`);
    throw new Error(`Tool "${toolName}" not found.`);
  }

  // context_switchツールは特別扱い - ここでは処理しない（上の特別ハンドラで処理済み）
  // ここに到達した場合は、context_switch以外のツールのはず

  const targetServerProcess = runningServers[targetServerName];
  if (!targetServerProcess) {
    logger.error(`Server process "${targetServerName}" for tool "${toolName}" not found or not running.`);
    throw new Error(`Server process "${targetServerName}" not available.`);
  }

  // Client/Transport/Schemaのインポートはトップレベルで行ったため削除

  // Helper to create StdioServerParameters from LaunchedServer
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
    name: `contextswitcher-${targetServerName}-client-call`, // 識別しやすい名前
    version: '0.1.0'
  });

  try {
    await client.connect(transport);
    logger.info({ toolName, targetServerName }, `Forwarding tools/call request...`);

    const callRequest = {
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs }
    } as const;

    // 適切な結果スキーマを使用
    const result = await client.request(callRequest, CallToolResultSchema);
    logger.info({ toolName, targetServerName }, `Received response from downstream server.`);
    return result; // そのままレスポンスを返す

  } catch (error) {
    logger.error({ err: error, toolName, targetServerName }, `Error forwarding tools/call request`);
    throw error; // エラーを上位に伝播させる
  } finally {
    await client.close();
    logger.debug({ toolName, targetServerName }, `Closed connection for tools/call.`);
  }
})

// エラーハンドリング
server.onerror = (error) => {
  logger.error('Server error:', error)
}

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
    const transport = new StdioServerTransport(process.stdin, process.stdout)
    await server.connect(transport)
    logger.info('MCP Server started')

    // 起動時に一度ツールリストを取得してマップを初期化
    await fetchAndAggregateTools();

  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// 実行
main()
