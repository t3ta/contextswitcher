# contextswitcher

**contextswitcher** is a lightweight MCP (Model Context Protocol) gateway that helps manage multiple MCP servers across different environments and projects. It enables tools like Claude Desktop and Roo Code to interact with various contextual AI agent setups seamlessly.

## 🚀 Features

- Launches and manages multiple MCP servers defined in `.roo/mcp.json`
- Routes `tools/list` requests to all registered servers and merges the results
- Supports context switching via the `context/switch` tool
- Adds configurable suffixes to tool names (default: `_cs`)
- Communicates with MCP servers over `stdio` for lightweight integration
- Designed for human-controlled context switching (explicit is better than implicit!)

## 🧩 Use Cases

- Serve as a single MCP entrypoint for Claude Desktop or Roo Code
- Run multiple specialized agents (e.g., coder, designer) and route requests accordingly
- Enable explicit switching between contexts in a project

## 📁 Project Structure (Planned)

```
contextswitcher/
├── src/
│   ├── cli.ts
│   ├── context.ts
│   ├── mcpLauncher.ts
│   ├── toolAggregator.ts
│   └── types.ts
├── .roo/
│   └── mcp.json
├── vitest.config.ts
└── package.json
```

## 📄 Example `.roo/mcp.json`

```json
{
  "mcpServers": {
    "contextSwitcher": {
      "command": "node",
      "args": ["dist/cli.js"],
      "cwd": "./",
      "env": {
        "SWITCHING_ENABLED": "true",
        "TOOL_SUFFIX": "_cs"
      }
    },
    "coder": {
      "command": "bun",
      "args": ["src/mcp-server.ts"],
      "cwd": "/Users/you/projects/awesome-agent/coder"
    },
    "designer": {
      "command": "bun",
      "args": ["src/mcp-server.ts"],
      "cwd": "/Users/you/projects/awesome-agent/designer"
    }
  }
}
```

## ⚙️ Context Switching

The `context/switch` tool allows you to dynamically change the set of MCP servers:

```json
{
  "method": "context/switch",
  "params": {
    "configPath": "/path/to/other/mcp.json"
  }
}
```

This will:

1. Load the specified configuration file
2. Stop all running MCP server processes
3. Start new servers based on the configuration
4. Return the new set of available tools

## 🏷️ Tool Suffix Configuration

All tools are exposed with a suffix (default: `_cs`) to avoid name collisions:

- Enable/disable with the `SWITCHING_ENABLED` environment variable in the contextSwitcher config
- Customize the suffix with the `TOOL_SUFFIX` environment variable

## 🛠 Development Notes

- CLI context switching UI (TUI or Web UI) planned
- Goal: route all MCP traffic from Claude, Gemini, CLI, and CI tools through this gateway

---
