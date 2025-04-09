import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import { McpServerConfig } from './context.js' // .jsを追加

// LaunchedServerに設定情報を追加
export type LaunchedServer = McpServerConfig & {
  process: ChildProcessWithoutNullStreams
}

export async function spawnMcpServers(servers: McpServerConfig[]): Promise<LaunchedServer[]> {
  return servers.map((server) => {
    const proc = spawn(server.command, server.args, {
      cwd: server.cwd,
      stdio: 'pipe',
      env: {
        ...process.env, // 既存の環境変数をコピー
        ...(server.env || {}), // サーバー固有の設定で上書き
        // PATHは特別扱い：既存のPATHを先に配置し、その後にサーバー固有のPATHを追加
        PATH: `${process.env.PATH || ''}${server.env?.PATH ? ':' + server.env.PATH : ''}`
      }
    })

    proc.stderr.on('data', (data) => {
      process.stderr.write(`[${server.name} ERROR] ${data}`)
    })

    proc.on('exit', (code) => {
      process.stderr.write(
        `[${server.name}] exited with code ${code}\n`
      )
    })

    return {
      ...server, // 元の設定情報をコピー
      process: proc
    }
  })
}
