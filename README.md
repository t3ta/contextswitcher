# contextswitcher

**contextswitcher** is a lightweight MCP (Model Context Protocol) gateway that helps manage multiple MCP servers across different environments and projects. It enables tools like Claude Desktop and Roo Code to interact with various contextual AI agent setups seamlessly.

## 🚀 Features

- Launches and manages multiple MCP servers defined in `.roo/mcp.json`
- Routes `tools/list` requests to all registered servers and merges the results
- Communicates with MCP servers over `stdio` for lightweight integration
- Designed for human-controlled context switching (explicit is better than implicit!)
- Future support for `memory/read`, `memory/write`, and more

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
  "servers": [
    {
      "name": "designer",
      "command": "bun",
      "args": ["src/mcp-server.ts"],
      "cwd": "/Users/you/projects/awesome-agent/designer"
    },
    {
      "name": "coder",
      "command": "bun",
      "args": ["src/mcp-server.ts"],
      "cwd": "/Users/you/projects/awesome-agent/coder"
    }
  ]
}
```

## 🛠 Development Notes

- MVP supports only `tools/list` merging
- CLI context switching UI (TUI or Web UI) planned
- Goal: route all MCP traffic from Claude, Gemini, CLI, and CI tools through this gateway

---
