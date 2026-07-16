# MCP connector starter

This folder creates standalone Streamable HTTP MCP servers. They are intentionally separate from the Obsidian plugin: a server runs in an environment you control, while the mobile-compatible plugin only connects to its HTTPS endpoint.

Create a connector with Node 18 or later:

```powershell
node .\mcp-connectors\create-connector.mjs .\my-mcp "My MCP"
cd .\my-mcp
npm install
npm run dev
```

The generated server exposes `POST`, `GET`, and `DELETE` at `/mcp`, includes one read-only `health_check` tool, and uses the MCP TypeScript SDK's Streamable HTTP transport. Replace that tool with a narrow integration for the target application. Keep write operations disabled by default and declare `readOnlyHint: true` only for tools that have no side effects.

For production, place the endpoint behind HTTPS and an authentication layer. Add its `/mcp` URL as an MCP connection in **Settings → Sovereign Router**. The plugin accepts plain HTTP only for `localhost`.
