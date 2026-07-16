export interface McpServerConfig {
	id: string;
	name: string;
	url: string;
	secretName: string;
	enabled: boolean;
	allowWriteTools: boolean;
}

export interface McpToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
}

export interface McpTool {
	serverId: string;
	serverName: string;
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations: McpToolAnnotations;
}

export interface McpToolCall {
	callId: string;
	tool: McpTool;
	arguments: Record<string, unknown>;
}
