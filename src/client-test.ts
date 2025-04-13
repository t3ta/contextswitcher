#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawn } from 'child_process'
import console from 'console'
import { ContextSwitchResultSchema } from './cli.js'

async function testContextSwitcher() {
  console.log('Starting test client for contextswitcher...')

  // 10秒後にタイムアウトで終了
  const timeout = setTimeout(() => {
    console.error('Test timed out after 10 seconds')
    process.exit(1)
  }, 10000)

  // クライアントのセットアップ
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['src/cli.ts'],
    cwd: process.cwd(),
    stderr: 'inherit'
  })

  const client = new Client({
    name: 'test-client',
    version: '0.1.0'
  })

  try {
    // クライアントをサーバーに接続
    await client.connect(transport)
    console.log('Connected to server')

    // tools/listリクエスト
    console.log('Sending tools/list request...')
    try {
      const listResult = await client.listTools()
      console.log('Got tools/list response:')
      console.log(JSON.stringify(listResult, null, 2))
    } catch (error) {
      console.error('Error in tools/list:', error.message)
    }

    // context_switchリクエスト（サフィックスなし）
    console.log('Sending context_switch request...')
    try {
      const contextSwitchResult = await client.request({
        method: 'context_switch',  // サフィックスなしに修正
        params: {
          configPath: '.roo/mcp.sample.json'
        }
      }, ContextSwitchResultSchema)
      console.log('Got context_switch response:')
      console.log(JSON.stringify(contextSwitchResult, null, 2))
    } catch (error) {
      console.error('Error in context_switch:', error.message)
    }

    clearTimeout(timeout)
    console.log('Test completed successfully')
  } catch (error) {
    console.error('Test failed:', error)
  } finally {
    await client.close()
    console.log('Client closed')
    process.exit(0)
  }
}

testContextSwitcher()
