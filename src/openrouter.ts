import { requestUrl } from 'obsidian';
import { parseGatekeeperDecision, routingSystemPrompt } from './routing';
import type { SovereignRouterSettings } from './settings';
import { SseParser } from './sse';
import type { ChatMessage, GatekeeperDecision, Usage } from './types';

export { SseParser } from './sse';

const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterError extends Error {
	constructor(message: string, readonly status?: number) { super(message); }
}
export class StreamingUnavailableError extends Error {}

interface CompletionChoice { message?: { content?: string | null }; delta?: { content?: string | null }; }
interface CompletionResponse { model?: string; choices?: CompletionChoice[]; usage?: Usage; error?: { message?: string }; }
export interface StreamCallbacks { onDelta: (text: string) => void; onUsage: (usage: Usage) => void; onModel: (model: string) => void; }

function headers(apiKey: string): Record<string, string> {
	return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Sovereign Router' };
}
function errorMessage(status: number, body: CompletionResponse | undefined): string { return body?.error?.message || `OpenRouter request failed (${status}).`; }
function executorMessages(messages: ChatMessage[], skillContent: string | null): Array<{ role: string; content: string }> {
	const system = skillContent ? [{ role: 'system', content: `Follow this skill as additional system guidance:\n\n${skillContent}` }] : [];
	return [...system, ...messages];
}
async function requestCompletion(payload: Record<string, unknown>, apiKey: string): Promise<CompletionResponse> {
	const response = await requestUrl({ url: CHAT_COMPLETIONS_URL, method: 'POST', headers: headers(apiKey), body: JSON.stringify(payload), throw: false });
	const body = response.json as CompletionResponse;
	if (response.status < 200 || response.status >= 300) throw new OpenRouterError(errorMessage(response.status, body), response.status);
	return body;
}

export async function routeWithGatekeeper(question: string, settings: SovereignRouterSettings, apiKey: string): Promise<GatekeeperDecision | null> {
	const response = await requestCompletion({ model: settings.gatekeeperModel, temperature: 0, messages: [{ role: 'system', content: routingSystemPrompt(settings) }, { role: 'user', content: question }] }, apiKey);
	const content = response.choices?.[0]?.message?.content;
	if (!content) return null;
	try { return parseGatekeeperDecision(JSON.parse(content)); } catch (_error) { return null; }
}

function handleSseEvent(event: string, callbacks: StreamCallbacks): void {
	if (event === '[DONE]') return;
	let payload: CompletionResponse;
	try { payload = JSON.parse(event) as CompletionResponse; } catch (_error) { return; }
	if (payload.error?.message) throw new OpenRouterError(payload.error.message);
	if (payload.model) callbacks.onModel(payload.model);
	if (payload.usage) callbacks.onUsage(payload.usage);
	const content = payload.choices?.[0]?.delta?.content;
	if (content) callbacks.onDelta(content);
}

export async function streamExecutor(model: string, messages: ChatMessage[], skillContent: string | null, apiKey: string, callbacks: StreamCallbacks, signal: AbortSignal): Promise<void> {
	let response: Response;
	try {
		response = await fetch(CHAT_COMPLETIONS_URL, { method: 'POST', headers: headers(apiKey), body: JSON.stringify({ model, messages: executorMessages(messages, skillContent), stream: true }), signal });
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new StreamingUnavailableError('Streaming is not available in this environment.');
	}
	if (!response.ok) {
		let body: CompletionResponse | undefined;
		try { body = (await response.json()) as CompletionResponse; } catch (_error) { /* status remains useful */ }
		throw new OpenRouterError(errorMessage(response.status, body), response.status);
	}
	if (!response.body) throw new StreamingUnavailableError('Streaming response body is unavailable.');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parser = new SseParser();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		for (const event of parser.push(decoder.decode(value, { stream: true }))) handleSseEvent(event, callbacks);
	}
	for (const event of parser.push(decoder.decode())) handleSseEvent(event, callbacks);
	for (const event of parser.finish()) handleSseEvent(event, callbacks);
}

export async function completeExecutor(model: string, messages: ChatMessage[], skillContent: string | null, apiKey: string): Promise<{ content: string; usage?: Usage; model: string }> {
	const response = await requestCompletion({ model, messages: executorMessages(messages, skillContent), stream: false }, apiKey);
	return { content: response.choices?.[0]?.message?.content || '', usage: response.usage, model: response.model || model };
}
