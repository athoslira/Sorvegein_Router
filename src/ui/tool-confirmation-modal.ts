import { App, Modal } from 'obsidian';
import type { McpToolCall } from '../mcp-types';

export function confirmMcpToolCall(app: App, call: McpToolCall): Promise<boolean> {
	return new Promise((resolve) => new ToolConfirmationModal(app, call, resolve).open());
}

class ToolConfirmationModal extends Modal {
	private answered = false;
	constructor(app: App, private readonly call: McpToolCall, private readonly resolve: (approved: boolean) => void) { super(app); }

	onOpen(): void {
		this.titleEl.setText('Confirm MCP action');
		this.contentEl.createEl('p', { text: `${this.call.tool.serverName} wants to run ${this.call.tool.name}.` });
		this.contentEl.createEl('pre', { text: JSON.stringify(this.call.arguments, null, 2), cls: 'sr-tool-arguments' });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		const confirm = buttons.createEl('button', { text: 'Allow', cls: 'mod-cta' });
		cancel.addEventListener('click', () => { this.answer(false); });
		confirm.addEventListener('click', () => { this.answer(true); });
	}

	onClose(): void {
		if (!this.answered) this.answer(false);
		this.contentEl.empty();
	}

	private answer(approved: boolean): void {
		if (this.answered) return;
		this.answered = true;
		this.resolve(approved);
		this.close();
	}
}
