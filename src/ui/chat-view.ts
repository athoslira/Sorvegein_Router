import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf } from 'obsidian';
import { completeExecutor, OpenRouterError, routeWithGatekeeper, StreamingUnavailableError, streamExecutor } from '../openrouter';
import { fallbackRoute, selectRoute } from '../routing';
import { SkillResolver } from '../skills';
import type SovereignRouterPlugin from '../main';
import type { ChatMessage, Usage } from '../types';

export const VIEW_TYPE_SOVEREIGN_ROUTER = 'sovereign-router-chat';

interface AssistantElements { bodyEl: HTMLElement; metaEl: HTMLElement; }

function formatError(error: unknown): string {
	if (error instanceof OpenRouterError) {
		if (error.status === 401) return 'Your OpenRouter API key is invalid or unavailable.';
		if (error.status === 402) return 'Your OpenRouter account has insufficient credits.';
		if (error.status === 429) return 'OpenRouter is rate-limiting this request. Please try again shortly.';
		if (error.status && error.status >= 500) return 'OpenRouter or the selected provider is temporarily unavailable.';
		return error.message;
	}
	if (error instanceof DOMException && error.name === 'AbortError') return 'Response cancelled.';
	return 'The request could not be completed. Please check your network connection and settings.';
}
function formatUsage(model: string, usage?: Usage, suffix?: string): string {
	const parts = [model];
	if (typeof usage?.cost === 'number') parts.push(`$${usage.cost.toFixed(6)}`);
	if ((usage?.prompt_tokens_details?.cached_tokens ?? 0) > 0) parts.push('cache hit');
	if (suffix) parts.push(suffix);
	return parts.join(' · ');
}

export class SovereignRouterView extends ItemView {
	private readonly history: ChatMessage[] = [];
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private abortController: AbortController | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: SovereignRouterPlugin) { super(leaf); }
	getViewType(): string { return VIEW_TYPE_SOVEREIGN_ROUTER; }
	getDisplayText(): string { return 'Sovereign Router'; }

	async onOpen(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('sovereign-router-view');
		const header = this.containerEl.createDiv({ cls: 'sr-header' });
		header.createEl('h4', { text: 'Sovereign Router' });
		header.createSpan({ text: 'BYOK · session only', cls: 'sr-header-note' });
		this.messagesEl = this.containerEl.createDiv({ cls: 'sr-messages' });
		const composer = this.containerEl.createDiv({ cls: 'sr-composer' });
		this.inputEl = composer.createEl('textarea', { cls: 'sr-input', attr: { placeholder: 'Ask anything…', rows: '3', 'aria-label': 'Chat message' } });
		const actions = composer.createDiv({ cls: 'sr-actions' });
		this.cancelButton = actions.createEl('button', { text: 'Cancel', cls: 'sr-button sr-cancel' });
		this.sendButton = actions.createEl('button', { text: 'Send', cls: 'sr-button sr-send' });
		this.setBusy(false);
		this.registerDomEvent(this.inputEl, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void this.sendMessage(); }
		});
		this.registerDomEvent(this.sendButton, 'click', () => void this.sendMessage());
		this.registerDomEvent(this.cancelButton, 'click', () => this.abortController?.abort());
	}
	async onClose(): Promise<void> { this.abortController?.abort(); }

	private async sendMessage(): Promise<void> {
		const question = this.inputEl.value.trim();
		if (!question || this.abortController) return;
		const secretName = this.plugin.settings.openRouterSecretName;
		const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (!apiKey) { new Notice('Select an OpenRouter API key in Sovereign Router settings first.'); return; }
		this.inputEl.value = '';
		this.appendUser(question);
		this.history.push({ role: 'user', content: question });
		const assistant = this.appendAssistant();
		this.abortController = new AbortController();
		this.setBusy(true);
		let assistantText = '';
		try {
			let route;
			try { route = selectRoute(await routeWithGatekeeper(question, this.plugin.settings, apiKey), this.plugin.settings); }
			catch (_error) { route = fallbackRoute(this.plugin.settings, 'Gatekeeper unavailable; using the default model.'); }
			assistant.metaEl.setText(route.note || `Routing to ${route.model}…`);
			const skill = await new SkillResolver(this.app, this.plugin.settings).resolve(route.skill);
			if (skill.note) assistant.metaEl.setText(`${route.note ? `${route.note} ` : ''}${skill.note}`);
			const callbacks = {
				onDelta: (text: string) => { assistantText += text; assistant.bodyEl.setText(assistantText); this.scrollToBottom(); },
				onUsage: (usage: Usage) => assistant.metaEl.setText(formatUsage(route.model, usage)),
				onModel: (model: string) => assistant.metaEl.setText(formatUsage(model)),
			};
			try {
				await streamExecutor(route.model, this.history, skill.content, apiKey, callbacks, this.abortController.signal);
			} catch (error) {
				if (!(error instanceof StreamingUnavailableError) || assistantText) throw error;
				const fallback = await completeExecutor(route.model, this.history, skill.content, apiKey);
				assistantText = fallback.content;
				assistant.metaEl.setText(formatUsage(fallback.model, fallback.usage, 'non-streaming fallback'));
			}
			this.history.push({ role: 'assistant', content: assistantText });
			await this.renderMarkdown(assistant.bodyEl, assistantText);
		} catch (error) {
			const message = formatError(error);
			assistant.metaEl.setText('Request error');
			if (assistantText) { assistant.bodyEl.setText(`${assistantText}\n\n_${message}_`); this.history.push({ role: 'assistant', content: assistantText }); }
			else assistant.bodyEl.setText(message);
		} finally {
			this.abortController = null;
			this.setBusy(false);
			this.scrollToBottom();
		}
	}

	private appendUser(content: string): void {
		const message = this.messagesEl.createDiv({ cls: 'sr-message sr-user' });
		message.createDiv({ text: content, cls: 'sr-message-body' });
		this.scrollToBottom();
	}
	private appendAssistant(): AssistantElements {
		const messageEl = this.messagesEl.createDiv({ cls: 'sr-message sr-assistant' });
		const metaEl = messageEl.createDiv({ text: 'Preparing request…', cls: 'sr-message-meta' });
		const bodyEl = messageEl.createDiv({ cls: 'sr-message-body' });
		return { metaEl, bodyEl };
	}
	private async renderMarkdown(element: HTMLElement, content: string): Promise<void> {
		element.empty();
		await MarkdownRenderer.renderMarkdown(content, element, '', this);
	}
	private setBusy(isBusy: boolean): void {
		this.sendButton.disabled = isBusy;
		this.cancelButton.disabled = !isBusy;
		this.inputEl.disabled = isBusy;
	}
	private scrollToBottom(): void {
		window.setTimeout(() => { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }, 0);
	}
}
