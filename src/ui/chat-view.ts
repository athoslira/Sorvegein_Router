import { ItemView, MarkdownRenderer, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { buildDocumentContext, limitDocumentContent, type AttachedDocument } from '../document-context';
import { isSupportedDocument, isTextDocument, needsDoclingConversion } from '../document-files';
import { convertWithDocling, DoclingError } from '../docling';
import type { McpClient } from '../mcp-client';
import { loadMcpCatalog, parseMcpToolCalls, toExecutorTools, type McpCatalog } from '../mcp-tools';
import { canCallMcpTool } from '../mcp-policy';
import type { McpToolCall } from '../mcp-types';
import type SovereignRouterPlugin from '../main';
import { modelLabel } from '../models';
import { completeExecutor, OpenRouterError, routeWithGatekeeper, StreamingUnavailableError, streamExecutor } from '../openrouter';
import { fallbackRoute, selectRoute } from '../routing';
import { SkillResolver } from '../skills';
import type { ChatMessage, OpenRouterToolCall, RouteResult, Usage } from '../types';
import { confirmMcpToolCall } from './tool-confirmation-modal';
import { VaultFolderPicker } from './vault-folder-picker';

export const VIEW_TYPE_SOVEREIGN_ROUTER = 'sovereign-router-chat';

interface AssistantElements {
	bodyEl: HTMLElement;
	metaEl: HTMLElement;
}

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
	const parts = [modelLabel(model)];
	if (typeof usage?.cost === 'number') parts.push(`$${usage.cost.toFixed(6)}`);
	if ((usage?.prompt_tokens_details?.cached_tokens ?? 0) > 0) parts.push('cache hit');
	if (suffix) parts.push(suffix);
	return parts.join(' | ');
}

export class SovereignRouterView extends ItemView {
	private readonly history: ChatMessage[] = [];
	private readonly documents: AttachedDocument[] = [];
	private messagesEl!: HTMLElement;
	private attachmentsEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private fileInput!: HTMLInputElement;
	private modelSelect!: HTMLSelectElement;
	private mcpToggle!: HTMLInputElement;
	private attachButton!: HTMLButtonElement;
	private folderButton!: HTMLButtonElement;
	private sendButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private abortController: AbortController | null = null;
	private isConvertingDocument = false;
	private mcpClients = new Map<string, McpClient>();

	constructor(leaf: WorkspaceLeaf, private readonly plugin: SovereignRouterPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SOVEREIGN_ROUTER;
	}

	getDisplayText(): string {
		return 'Sovereign Router';
	}

	async onOpen(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('sovereign-router-view');
		const header = this.containerEl.createDiv({ cls: 'sr-header' });
		header.createEl('h4', { text: 'Sovereign Router' });
		const controls = header.createDiv({ cls: 'sr-header-controls' });
		this.modelSelect = controls.createEl('select', {
			cls: 'sr-model-select',
			attr: { 'aria-label': 'Executor model' },
		});
		this.modelSelect.createEl('option', { text: 'Auto route', value: '' });
		for (const model of this.plugin.settings.permittedExecutorModels) {
			this.modelSelect.createEl('option', { text: modelLabel(model), value: model });
		}
		const mcpControl = controls.createEl('label', { cls: 'sr-mcp-toggle' });
		this.mcpToggle = mcpControl.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Use MCP tools' } });
		mcpControl.createSpan({ text: 'MCP' });
		controls.createSpan({ text: 'Session only', cls: 'sr-header-note' });

		this.messagesEl = this.containerEl.createDiv({ cls: 'sr-messages' });
		const composer = this.containerEl.createDiv({ cls: 'sr-composer' });
		this.attachmentsEl = composer.createDiv({ cls: 'sr-attachments' });
		this.fileInput = composer.createEl('input', {
			cls: 'sr-file-input',
			attr: {
				type: 'file',
				multiple: 'true',
				accept: '.pdf,.docx,.pptx,.xlsx,.odt,.ods,.odp,.html,.htm,.epub,.txt,.md,.csv,.png,.jpg,.jpeg,.tiff',
			},
		});
		this.inputEl = composer.createEl('textarea', {
			cls: 'sr-input',
			attr: { placeholder: 'Ask anything...', rows: '3', 'aria-label': 'Chat message' },
		});
		const actions = composer.createDiv({ cls: 'sr-actions' });
		this.attachButton = actions.createEl('button', { text: 'Attach document', cls: 'sr-button sr-attach' });
		this.folderButton = actions.createEl('button', { text: 'Attach vault folder', cls: 'sr-button sr-folder' });
		this.cancelButton = actions.createEl('button', { text: 'Cancel', cls: 'sr-button sr-cancel' });
		this.sendButton = actions.createEl('button', { text: 'Send', cls: 'sr-button sr-send' });
		this.setBusy(false);

		this.registerDomEvent(this.inputEl, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void this.sendMessage();
			}
		});
		this.registerDomEvent(this.sendButton, 'click', () => void this.sendMessage());
		this.registerDomEvent(this.cancelButton, 'click', () => this.abortController?.abort());
		this.registerDomEvent(this.attachButton, 'click', () => this.fileInput.click());
		this.registerDomEvent(this.folderButton, 'click', () => this.openFolderPicker());
		this.registerDomEvent(this.fileInput, 'change', () => {
			if (this.fileInput.files) void this.attachDocuments(this.fileInput.files);
		});
	}

	private openFolderPicker(): void {
		if (this.isConvertingDocument || this.abortController) return;
		new VaultFolderPicker(this.app, (folder) => void this.attachVaultFolder(folder)).open();
	}

	async onClose(): Promise<void> {
		this.abortController?.abort();
		await this.closeMcpClients();
	}

	private async attachDocuments(files: FileList): Promise<void> {
		if (!this.plugin.settings.doclingServiceUrl) {
			new Notice('Configure a Docling service URL before attaching documents.');
			this.fileInput.value = '';
			return;
		}
		const secretName = this.plugin.settings.doclingSecretName;
		const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (secretName && !apiKey) {
			new Notice('The selected Docling API key is unavailable.');
			this.fileInput.value = '';
			return;
		}

		this.isConvertingDocument = true;
		this.attachButton.setText('Converting...');
		this.setBusy(Boolean(this.abortController));
		try {
			for (const file of Array.from(files)) {
				try {
					const markdown = await convertWithDocling(file, this.plugin.settings.doclingServiceUrl, apiKey);
					const limited = limitDocumentContent(markdown);
					this.documents.push({ name: file.name, markdown: limited.content, truncated: limited.truncated });
					new Notice(`${file.name} attached for this chat session.`);
				} catch (error) {
					const message = error instanceof DoclingError ? error.message : `Could not convert ${file.name}.`;
					new Notice(message);
				}
			}
			this.renderAttachments();
		} finally {
			this.isConvertingDocument = false;
			this.attachButton.setText('Attach document');
			this.fileInput.value = '';
			this.setBusy(Boolean(this.abortController));
		}
	}

	private async attachVaultFolder(folder: TFolder): Promise<void> {
		const prefix = folder.path ? `${folder.path}/` : '';
		const candidates = this.app.vault
			.getFiles()
			.filter((file) => file.path.startsWith(prefix) && isSupportedDocument(file.name));
		if (candidates.length === 0) {
			new Notice('No supported documents were found in this vault folder.');
			return;
		}

		const maximumFiles = 25;
		const availableSlots = Math.max(0, maximumFiles - this.documents.length);
		if (availableSlots === 0) {
			new Notice(`You can attach up to ${maximumFiles} documents to a chat session.`);
			return;
		}
		const files = candidates.slice(0, availableSlots);
		const secretName = this.plugin.settings.doclingSecretName;
		const doclingKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		const canUseDocling = Boolean(this.plugin.settings.doclingServiceUrl) && (!secretName || Boolean(doclingKey));

		this.isConvertingDocument = true;
		this.attachButton.setText('Reading...');
		this.folderButton.setText('Reading...');
		this.setBusy(false);
		let attached = 0;
		let skipped = candidates.length - files.length;
		try {
			for (const file of files) {
				try {
					const document = await this.readVaultDocument(file, folder.path, doclingKey, canUseDocling);
					if (!document) {
						skipped += 1;
						continue;
					}
					this.documents.push(document);
					attached += 1;
				} catch (_error) {
					skipped += 1;
				}
			}
			this.renderAttachments();
			const summary = [`${attached} file${attached === 1 ? '' : 's'} attached from ${folder.path || 'vault root'}.`];
			if (skipped) summary.push(`${skipped} skipped.`);
			if (!canUseDocling && files.some((file) => needsDoclingConversion(file.name))) {
				summary.push('Configure Docling to include PDFs and Office documents.');
			}
			new Notice(summary.join(' '));
		} finally {
			this.isConvertingDocument = false;
			this.attachButton.setText('Attach document');
			this.folderButton.setText('Attach vault folder');
			this.setBusy(false);
		}
	}

	private async readVaultDocument(
		file: TFile,
		folderPath: string,
		doclingKey: string | null,
		allowDocling: boolean,
	): Promise<AttachedDocument | null> {
		const relativeName = folderPath ? file.path.slice(folderPath.length + 1) : file.path;
		let content: string;
		if (isTextDocument(file.name)) {
			content = await this.app.vault.read(file);
		} else if (needsDoclingConversion(file.name) && allowDocling) {
			const binary = await this.app.vault.readBinary(file);
			content = await convertWithDocling(
				new File([binary], file.name, { type: 'application/octet-stream' }),
				this.plugin.settings.doclingServiceUrl,
				doclingKey,
			);
		} else {
			return null;
		}
		const limited = limitDocumentContent(content);
		return { name: relativeName, markdown: limited.content, truncated: limited.truncated };
	}

	private async sendMessage(): Promise<void> {
		const question = this.inputEl.value.trim();
		if (!question || this.abortController) return;
		if (this.isConvertingDocument) {
			new Notice('Wait for document conversion to finish before sending a message.');
			return;
		}
		const secretName = this.plugin.settings.openRouterSecretName;
		const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (!apiKey) {
			new Notice('Select an OpenRouter API key in Sovereign Router settings first.');
			return;
		}

		this.inputEl.value = '';
		this.appendUser(question);
		this.history.push({ role: 'user', content: question });
		const assistant = this.appendAssistant();
		this.abortController = new AbortController();
		this.setBusy(true);
		let assistantText = '';
		try {
			let route: RouteResult;
			try {
				route = selectRoute(await routeWithGatekeeper(question, this.plugin.settings, apiKey), this.plugin.settings);
			} catch (_error) {
				route = fallbackRoute(this.plugin.settings, 'Gatekeeper unavailable; using the default model.');
			}
			const manualModel = this.modelSelect.value;
			if (manualModel) {
				route = { ...route, model: manualModel, note: `Manual model: ${modelLabel(manualModel)}.` };
			}
			assistant.metaEl.setText(route.note || `Routing to ${modelLabel(route.model)}...`);
			const skill = await new SkillResolver(this.app, this.plugin.settings).resolve(route.skill);
			if (skill.note) assistant.metaEl.setText(`${route.note ? `${route.note} ` : ''}${skill.note}`);
			const documentContext = buildDocumentContext(this.documents);
			const catalog = this.mcpToggle.checked ? await this.loadMcpCatalog() : null;
			const executorTools = catalog ? toExecutorTools(catalog.tools) : [];
			if (catalog?.warnings.length) new Notice(catalog.warnings.join(' '));
			if (this.mcpToggle.checked && executorTools.length === 0) assistant.metaEl.setText('No MCP tools available; answering without them.');
			const callbacks = {
				onDelta: (text: string) => {
					assistantText += text;
					assistant.bodyEl.setText(assistantText);
					this.scrollToBottom();
				},
				onUsage: (usage: Usage) => assistant.metaEl.setText(formatUsage(route.model, usage)),
				onModel: (model: string) => assistant.metaEl.setText(formatUsage(model)),
			};
			await this.runExecutorWithMcp(route.model, skill.content, documentContext, apiKey, callbacks, assistant, catalog, executorTools, (text) => { assistantText = text; }, () => assistantText, () => { assistantText = ''; });
			await this.renderMarkdown(assistant.bodyEl, assistantText);
		} catch (error) {
			const message = formatError(error);
			assistant.metaEl.setText('Request error');
			if (assistantText) {
				assistant.bodyEl.setText(`${assistantText}\n\n_${message}_`);
				this.history.push({ role: 'assistant', content: assistantText });
			} else {
				assistant.bodyEl.setText(message);
			}
		} finally {
			this.abortController = null;
			this.setBusy(false);
			this.scrollToBottom();
		}
	}

	private async loadMcpCatalog(): Promise<McpCatalog> {
		await this.closeMcpClients();
		const catalog = await loadMcpCatalog(this.plugin.settings.mcpServers, (secretName) => this.app.secretStorage.getSecret(secretName));
		this.mcpClients = catalog.clients;
		return catalog;
	}

	private async closeMcpClients(): Promise<void> {
		const clients = [...this.mcpClients.values()];
		this.mcpClients.clear();
		await Promise.all(clients.map((client) => client.close()));
	}

	private async runExecutorWithMcp(
		model: string,
		skillContent: string | null,
		documentContext: string | null,
		apiKey: string,
		callbacks: { onDelta: (text: string) => void; onUsage: (usage: Usage) => void; onModel: (model: string) => void },
		assistant: AssistantElements,
		catalog: McpCatalog | null,
		executorTools: ReturnType<typeof toExecutorTools>,
		setText: (text: string) => void,
		getText: () => string,
		clearText: () => void,
	): Promise<void> {
		for (let round = 0; round < 3; round += 1) {
			let toolCalls: OpenRouterToolCall[];
			try {
				toolCalls = await streamExecutor(model, this.history, skillContent, documentContext, apiKey, callbacks, this.abortController?.signal as AbortSignal, executorTools);
			} catch (error) {
				if (!(error instanceof StreamingUnavailableError) || getText()) throw error;
				const fallback = await completeExecutor(model, this.history, skillContent, documentContext, apiKey, executorTools);
				setText(fallback.content);
				toolCalls = fallback.toolCalls;
				assistant.metaEl.setText(formatUsage(fallback.model, fallback.usage, 'non-streaming fallback'));
			}
			if (toolCalls.length === 0) {
				this.history.push({ role: 'assistant', content: getText() });
				return;
			}
			if (!catalog) throw new Error('The model requested MCP tools while MCP is disabled.');
			this.history.push({ role: 'assistant', content: getText() || null, tool_calls: toolCalls });
			assistant.metaEl.setText('Using connected MCP tools...');
			await this.executeMcpToolCalls(toolCalls, catalog);
			if (round === 2) {
				setText('The MCP tool-call limit was reached. Please narrow the request and try again.');
				this.history.push({ role: 'assistant', content: getText() });
				return;
			}
			clearText();
			assistant.bodyEl.empty();
		}
	}

	private async executeMcpToolCalls(toolCalls: OpenRouterToolCall[], catalog: McpCatalog): Promise<void> {
		const parsed = parseMcpToolCalls(toolCalls, catalog.tools);
		for (const call of parsed) {
			if ('error' in call) {
				this.history.push({ role: 'tool', content: call.error, tool_call_id: call.id });
				continue;
			}
			this.history.push({ role: 'tool', content: await this.executeMcpToolCall(call, catalog), tool_call_id: call.callId });
		}
	}

	private async executeMcpToolCall(call: McpToolCall, catalog: McpCatalog): Promise<string> {
		const server = this.plugin.settings.mcpServers.find((item) => item.id === call.tool.serverId);
		if (!server) return 'The requested MCP connection no longer exists.';
		const policy = canCallMcpTool(call.tool, server);
		if (!policy.allowed) return policy.reason || 'This MCP tool is not allowed.';
		if (policy.requiresConfirmation && !(await confirmMcpToolCall(this.app, call))) return 'The user declined this MCP action.';
		const client = catalog.clients.get(server.id);
		if (!client) return 'The MCP connection is unavailable.';
		try {
			return await client.callTool(call.tool.name, call.arguments, this.abortController?.signal);
		} catch (error) {
			return error instanceof Error ? `MCP tool error: ${error.message}` : 'MCP tool failed.';
		}
	}

	private renderAttachments(): void {
		this.attachmentsEl.empty();
		for (const [index, document] of this.documents.entries()) {
			const chip = this.attachmentsEl.createDiv({ cls: 'sr-attachment' });
			chip.createSpan({ text: document.truncated ? `${document.name} (truncated)` : document.name });
			const remove = chip.createEl('button', { text: 'Remove', cls: 'sr-attachment-remove' });
			this.registerDomEvent(remove, 'click', () => {
				this.documents.splice(index, 1);
				this.renderAttachments();
			});
		}
	}

	private appendUser(content: string): void {
		const message = this.messagesEl.createDiv({ cls: 'sr-message sr-user' });
		message.createDiv({ text: content, cls: 'sr-message-body' });
		this.scrollToBottom();
	}

	private appendAssistant(): AssistantElements {
		const messageEl = this.messagesEl.createDiv({ cls: 'sr-message sr-assistant' });
		const metaEl = messageEl.createDiv({ text: 'Preparing request...', cls: 'sr-message-meta' });
		const bodyEl = messageEl.createDiv({ cls: 'sr-message-body' });
		return { metaEl, bodyEl };
	}

	private async renderMarkdown(element: HTMLElement, content: string): Promise<void> {
		element.empty();
		await MarkdownRenderer.renderMarkdown(content, element, '', this);
	}

	private setBusy(isRequestBusy: boolean): void {
		const controlsDisabled = isRequestBusy || this.isConvertingDocument;
		this.sendButton.disabled = controlsDisabled;
		this.attachButton.disabled = controlsDisabled;
		this.folderButton.disabled = controlsDisabled;
		this.cancelButton.disabled = !isRequestBusy;
		this.inputEl.disabled = controlsDisabled;
		this.modelSelect.disabled = controlsDisabled;
		this.mcpToggle.disabled = controlsDisabled;
	}

	private scrollToBottom(): void {
		window.setTimeout(() => {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}, 0);
	}
}
