import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [directory, displayName] = process.argv.slice(2);
if (!directory || !displayName) {
	console.error('Usage: node mcp-connectors/create-connector.mjs <directory> <display-name>');
	process.exit(1);
}

const target = resolve(directory);
if (existsSync(target)) {
	console.error(`Refusing to overwrite existing directory: ${target}`);
	process.exit(1);
}

mkdirSync(resolve(target, 'src'), { recursive: true });
writeFileSync(resolve(target, 'package.json'), JSON.stringify({
	name: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mcp-connector',
	version: '0.1.0',
	private: true,
	type: 'module',
	scripts: { dev: 'tsx watch src/index.ts', start: 'tsx src/index.ts' },
	dependencies: { '@modelcontextprotocol/sdk': '^1.0.0', express: '^5.0.0', zod: '^4.0.0' },
	devDependencies: { '@types/express': '^5.0.0', tsx: '^4.19.0', typescript: '^5.8.0' },
}, null, 2));
writeFileSync(resolve(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: true } }, null, 2));
writeFileSync(resolve(target, 'src', 'index.ts'), `import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const app = createMcpExpressApp();
const transports = new Map<string, StreamableHTTPServerTransport>();

function createServer(): McpServer {
	const server = new McpServer({ name: ${JSON.stringify(displayName)}, version: '0.1.0' });
	server.registerTool('health_check', {
		description: 'Returns the connector health status.',
		inputSchema: { message: z.string().optional() },
		annotations: { readOnlyHint: true },
	}, async ({ message }) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, message: message ?? 'ready' }) }] }));
	return server;
}

app.post('/mcp', async (request: Request, response: Response) => {
	const sessionId = request.headers['mcp-session-id'];
	const current = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
	try {
		if (current) return await current.handleRequest(request, response, request.body);
		if (!isInitializeRequest(request.body)) return response.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Initialize first.' } });
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: randomUUID,
			onsessioninitialized: (id) => transports.set(id, transport),
		});
		transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
		await createServer().connect(transport);
		return await transport.handleRequest(request, response, request.body);
	} catch (error) {
		console.error(error);
		return response.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error.' } });
	}
});

app.get('/mcp', async (request: Request, response: Response) => {
	const sessionId = request.headers['mcp-session-id'];
	const transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
	if (!transport) return response.status(400).send('Invalid or missing session ID.');
	return transport.handleRequest(request, response);
});

app.delete('/mcp', async (request: Request, response: Response) => {
	const sessionId = request.headers['mcp-session-id'];
	const transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
	if (!transport) return response.status(400).send('Invalid or missing session ID.');
	return transport.handleRequest(request, response);
});

const port = Number(process.env.MCP_PORT || 3000);
app.listen(port, () => console.log(${JSON.stringify(displayName)} + ' listening at http://localhost:' + port + '/mcp'));
`);
console.log(`Created MCP connector at ${target}`);
