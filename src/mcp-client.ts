import { SseParser } from './sse';
import type { McpServerConfig, McpTool, McpToolAnnotations } from './mcp-types';
import { isAllowedMcpEndpoint } from './mcp-policy';

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcResponse {
	jsonrpc?: string;
	id?: number;
	result?: unknown;
	error?: { code?: number; message?: string };
}

interface McpToolsList {
	tools?: Array<{ name?: string; description?: string; inputSchema?: unknown; annotations?: McpToolAnnotations }>;
}

export class McpError extends Error {
	constructor(message: string, readonly status?: number) { super(message); }
}

export class McpClient {
	private requestId = 0;
	private sessionId: string | null = null;
	private initialized = false;

	constructor(private readonly server: McpServerConfig, private readonly apiKey: string | null) {}

	async listTools(): Promise<McpTool[]> {
		await this.initialize();
		const result = await this.request('tools/list', {});
		const tools = (result as McpToolsList).tools;
		if (!Array.isArray(tools)) throw new McpError('The MCP server returned an invalid tools list.');
		return tools.flatMap((tool) => {
			if (typeof tool.name !== 'string' || !tool.name || !isSchema(tool.inputSchema)) return [];
			return [{
				serverId: this.server.id,
				serverName: this.server.name,
				name: tool.name,
				description: typeof tool.description === 'string' ? tool.description : '',
				inputSchema: tool.inputSchema,
				annotations: isAnnotations(tool.annotations) ? tool.annotations : {},
			}];
		});
	}

	async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
		await this.initialize(signal);
		const result = await this.request('tools/call', { name, arguments: args }, signal);
		const content = JSON.stringify(result) || '{}';
		return content.length > 50_000 ? `${content.slice(0, 50_000)}\n[Tool result truncated]` : content;
	}

	async close(): Promise<void> {
		if (!this.sessionId) return;
		try {
			await fetch(this.server.url, {
				method: 'DELETE',
				headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL_VERSION, 'Mcp-Session-Id': this.sessionId },
			});
		} catch {
			// The remote server may already have expired the ephemeral session.
		} finally {
			this.sessionId = null;
			this.initialized = false;
		}
	}

	private async initialize(signal?: AbortSignal): Promise<void> {
		if (this.initialized) return;
		if (!isAllowedMcpEndpoint(this.server.url)) throw new McpError('The MCP URL must use HTTPS, or HTTP only on localhost.');
		await this.request('initialize', {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: 'Sovereign Router', version: '1.2.0' },
		}, signal);
		await this.notify('notifications/initialized');
		this.initialized = true;
	}

	private async notify(method: string): Promise<void> {
		await this.post({ jsonrpc: '2.0', method, params: {} }, false);
	}

	private async request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		const id = ++this.requestId;
		const response = await this.post({ jsonrpc: '2.0', id, method, params }, true, signal);
		if (!response || response.id !== id) throw new McpError('The MCP server returned an invalid response.');
		if (response.error) throw new McpError(response.error.message || 'The MCP server reported an error.');
		return response.result ?? {};
	}

	private async post(payload: Record<string, unknown>, expectResponse: boolean, signal?: AbortSignal): Promise<JsonRpcResponse | null> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': PROTOCOL_VERSION,
		};
		if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
		if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
		let response: Response;
		try {
			response = await fetch(this.server.url, { method: 'POST', headers, body: JSON.stringify(payload), signal });
		} catch {
			if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
			throw new McpError(`Could not reach ${this.server.name}.`);
		}
		const newSession = response.headers.get('Mcp-Session-Id');
		if (newSession) this.sessionId = newSession;
		if (!response.ok && response.status !== 202) throw new McpError(`MCP request failed (${response.status}).`, response.status);
		if (!expectResponse || response.status === 202) return null;
		return readJsonRpcResponse(response);
	}
}

function isSchema(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAnnotations(value: unknown): value is McpToolAnnotations {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonRpcResponse(response: Response): Promise<JsonRpcResponse> {
	const contentType = response.headers.get('Content-Type') || '';
	if (!contentType.includes('text/event-stream')) return (await response.json()) as JsonRpcResponse;
	if (!response.body) throw new McpError('The MCP server returned an empty event stream.');
	const parser = new SseParser();
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let latest: JsonRpcResponse | null = null;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		for (const event of parser.push(decoder.decode(value, { stream: true }))) latest = parseEvent(event, latest);
	}
	for (const event of parser.push(decoder.decode())) latest = parseEvent(event, latest);
	for (const event of parser.finish()) latest = parseEvent(event, latest);
	if (!latest) throw new McpError('The MCP server returned no JSON-RPC response.');
	return latest;
}

function parseEvent(event: string, latest: JsonRpcResponse | null): JsonRpcResponse | null {
	try { return JSON.parse(event) as JsonRpcResponse; } catch { return latest; }
}
