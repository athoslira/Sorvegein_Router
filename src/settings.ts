import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type SovereignRouterPlugin from './main';
import { DEFAULT_EXECUTOR_MODELS } from './models';
import type { McpServerConfig } from './mcp-types';
import { isAllowedMcpEndpoint } from './mcp-policy';

export interface SovereignRouterSettings {
	openRouterSecretName: string;
	gatekeeperModel: string;
	defaultExecutorModel: string;
	permittedExecutorModels: string[];
	modelCatalogVersion: number;
	routingInstruction: string;
	skillSearchPaths: string[];
	allowedGitHubRepos: string[];
	doclingServiceUrl: string;
	doclingSecretName: string;
	mcpServers: McpServerConfig[];
}

export const DEFAULT_SETTINGS: SovereignRouterSettings = {
	openRouterSecretName: '',
	gatekeeperModel: 'deepseek/deepseek-v4-flash',
	defaultExecutorModel: 'moonshotai/kimi-k2.7-code',
	permittedExecutorModels: DEFAULT_EXECUTOR_MODELS,
	modelCatalogVersion: 1,
	routingInstruction: 'Choose the best permitted executor model and, when useful, one available skill. Return only the required JSON object.',
	skillSearchPaths: ['05 Skills/Métodos', '05 Skills', '03 Projects/Héstia/05 Skills'],
	allowedGitHubRepos: [],
	doclingServiceUrl: '',
	doclingSecretName: '',
	mcpServers: [],
};

function splitLines(value: string): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }

export class SovereignRouterSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SovereignRouterPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Sovereign Router' });
		containerEl.createEl('p', { text: 'Messages and selected skills are sent to OpenRouter only when you send a chat message. Attached documents are sent to the configured Docling service. No conversation or document is saved by this plugin.' });
		new Setting(containerEl).setName('OpenRouter API key').setDesc('Choose or create a secret. The plugin stores only its reference in data.json.').addComponent((component) => {
			const secretComponent = new SecretComponent(this.app, component).setValue(this.plugin.settings.openRouterSecretName);
			secretComponent.onChange(async (value) => {
				this.plugin.settings.openRouterSecretName = value;
				await this.plugin.saveSettings();
			});
			return secretComponent;
		});
		this.addTextSetting('Gatekeeper model', 'Classifies a request and chooses the executor.', this.plugin.settings.gatekeeperModel, async (value) => { this.plugin.settings.gatekeeperModel = value; });
		this.addTextSetting('Default executor model', 'Used when the Gatekeeper cannot provide a permitted route.', this.plugin.settings.defaultExecutorModel, async (value) => { this.plugin.settings.defaultExecutorModel = value; });
		this.addTextAreaSetting('Permitted executor models', 'One OpenRouter model slug per line. The Gatekeeper cannot select a model outside this list.', this.plugin.settings.permittedExecutorModels.join('\n'), async (value) => { this.plugin.settings.permittedExecutorModels = splitLines(value); });
		this.addTextAreaSetting('Routing instruction', 'Additional instruction for the Gatekeeper. It must still return the plugin JSON contract.', this.plugin.settings.routingInstruction, async (value) => { this.plugin.settings.routingInstruction = value.trim(); });
		this.addTextAreaSetting('Local skill folders', 'Vault-relative folders searched in order, one per line.', this.plugin.settings.skillSearchPaths.join('\n'), async (value) => { this.plugin.settings.skillSearchPaths = splitLines(value); });
		this.addTextAreaSetting('Allowed GitHub repositories', 'One owner/repository pair per line. Remote skills from any other repository are rejected.', this.plugin.settings.allowedGitHubRepos.join('\n'), async (value) => { this.plugin.settings.allowedGitHubRepos = splitLines(value); });
		containerEl.createEl('h3', { text: 'Document conversion (Docling)' });
		this.addTextSetting('Docling service URL', 'Optional. Enter the URL of your docling-serve instance, such as http://localhost:5001.', this.plugin.settings.doclingServiceUrl, async (value) => { this.plugin.settings.doclingServiceUrl = value.replace(/\/$/, ''); });
		new Setting(containerEl).setName('Docling API key').setDesc('Optional. Choose the secret required by your Docling service. The plugin stores only its reference.').addComponent((component) => {
			const secretComponent = new SecretComponent(this.app, component).setValue(this.plugin.settings.doclingSecretName);
			secretComponent.onChange(async (value) => {
				this.plugin.settings.doclingSecretName = value;
				await this.plugin.saveSettings();
			});
			return secretComponent;
		});
		containerEl.createEl('h3', { text: 'MCP connections' });
		containerEl.createEl('p', { text: 'Connect remote MCP servers over Streamable HTTP. Read-only tools can be used in chat. Write tools stay disabled until you explicitly enable them and confirm each call.' });
		new Setting(containerEl).setName('Add MCP connection').setDesc('Use HTTPS. HTTP is accepted only for localhost.').addButton((button) => button.setButtonText('Add connection').onClick(async () => {
			this.plugin.settings.mcpServers.push(createMcpServer());
			await this.plugin.saveSettings();
			this.display();
		}));
		for (const server of this.plugin.settings.mcpServers) this.addMcpServerSettings(server);
	}

	private addMcpServerSettings(server: McpServerConfig): void {
		const heading = this.containerEl.createEl('h4', { text: server.name || 'MCP connection' });
		heading.addClass('sr-settings-mcp-heading');
		this.addTextSetting('Connection name', 'A local label for this MCP server.', server.name, async (value) => { server.name = value || 'MCP connection'; });
		this.addTextSetting('MCP URL', 'The server Streamable HTTP endpoint.', server.url, async (value) => { server.url = value.replace(/\/$/, ''); });
		new Setting(this.containerEl).setName('MCP API key').setDesc('Optional. The plugin stores only this secret reference.').addComponent((component) => {
			const secretComponent = new SecretComponent(this.app, component).setValue(server.secretName);
			secretComponent.onChange(async (value) => {
				server.secretName = value;
				await this.plugin.saveSettings();
			});
			return secretComponent;
		});
		new Setting(this.containerEl).setName('Enable connection').setDesc(isAllowedMcpEndpoint(server.url) || !server.url ? 'Allow this server to expose its tools to the chat panel.' : 'Invalid URL: use HTTPS or HTTP only on localhost.').addToggle((toggle) => toggle.setValue(server.enabled).onChange(async (value) => {
			server.enabled = value;
			await this.plugin.saveSettings();
		}));
		new Setting(this.containerEl).setName('Allow write tools').setDesc('Requires a confirmation for every tool call. Keep disabled unless this server is trusted.').addToggle((toggle) => toggle.setValue(server.allowWriteTools).onChange(async (value) => {
			server.allowWriteTools = value;
			await this.plugin.saveSettings();
		}));
		new Setting(this.containerEl).setName('Remove connection').setDesc('Removes this connection configuration, not the remote MCP server.').addButton((button) => button.setWarning().setButtonText('Remove').onClick(async () => {
			this.plugin.settings.mcpServers = this.plugin.settings.mcpServers.filter((item) => item.id !== server.id);
			await this.plugin.saveSettings();
			this.display();
		}));
	}

	private addTextSetting(name: string, description: string, value: string, onChange: (value: string) => Promise<void>): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addText((text) => text.setValue(value).onChange(async (newValue) => { await onChange(newValue.trim()); await this.plugin.saveSettings(); }));
	}
	private addTextAreaSetting(name: string, description: string, value: string, onChange: (value: string) => Promise<void>): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addTextArea((text) => text.setValue(value).onChange(async (newValue) => { await onChange(newValue); await this.plugin.saveSettings(); }));
	}
}

function createMcpServer(): McpServerConfig {
	return {
		id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `mcp-${Date.now()}`,
		name: 'New MCP connection',
		url: '',
		secretName: '',
		enabled: false,
		allowWriteTools: false,
	};
}
