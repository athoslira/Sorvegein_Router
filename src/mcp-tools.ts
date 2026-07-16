import { McpClient, McpError } from './mcp-client';
import type { McpServerConfig, McpTool, McpToolCall } from './mcp-types';
import type { ExecutorTool } from './openrouter';
import type { OpenRouterToolCall } from './types';

export interface McpCatalog {
	tools: McpTool[];
	clients: Map<string, McpClient>;
	warnings: string[];
}

export async function loadMcpCatalog(
	servers: McpServerConfig[],
	getSecret: (secretName: string) => string | null,
): Promise<McpCatalog> {
	const clients = new Map<string, McpClient>();
	const warnings: string[] = [];
	const groups = await Promise.all(servers.filter((server) => server.enabled).map(async (server) => {
		const apiKey = server.secretName ? getSecret(server.secretName) : null;
		if (server.secretName && !apiKey) {
			warnings.push(`${server.name}: selected API key is unavailable.`);
			return [] as McpTool[];
		}
		const client = new McpClient(server, apiKey);
		clients.set(server.id, client);
		try {
			return await client.listTools();
		} catch (error) {
			const message = error instanceof McpError ? error.message : 'Could not load tools.';
			warnings.push(`${server.name}: ${message}`);
			return [] as McpTool[];
		}
	}));
	return { tools: groups.flat(), clients, warnings };
}

export function toExecutorTools(tools: McpTool[]): ExecutorTool[] {
	return tools.map((tool) => ({
		type: 'function',
		function: {
			name: executorToolName(tool),
			description: `${tool.serverName}: ${tool.description || tool.name}`,
			parameters: tool.inputSchema,
		},
	}));
}

export function parseMcpToolCalls(calls: OpenRouterToolCall[], tools: McpTool[]): Array<McpToolCall | { error: string; id: string }> {
	return calls.map((call) => {
		const tool = tools.find((candidate) => executorToolName(candidate) === call.function.name);
		if (!tool) return { error: `The model requested an unknown MCP tool: ${call.function.name}.`, id: call.id };
		try {
			const args = JSON.parse(call.function.arguments) as unknown;
			if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: `Invalid arguments for ${tool.name}.`, id: call.id };
			return { callId: call.id, tool, arguments: args as Record<string, unknown> };
		} catch (_error) {
			return { error: `Invalid arguments for ${tool.name}.`, id: call.id };
		}
	});
}

export function executorToolName(tool: McpTool): string {
	const value = `mcp_${tool.serverId}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
	return `${value.slice(0, 55)}_${shortHash(value)}`;
}

function shortHash(value: string): string {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ (value.charCodeAt(index));
	return (hash >>> 0).toString(36);
}
