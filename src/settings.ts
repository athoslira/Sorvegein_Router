import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type SovereignRouterPlugin from './main';

export interface SovereignRouterSettings {
	openRouterSecretName: string;
	gatekeeperModel: string;
	defaultExecutorModel: string;
	permittedExecutorModels: string[];
	routingInstruction: string;
	skillSearchPaths: string[];
	allowedGitHubRepos: string[];
}

export const DEFAULT_SETTINGS: SovereignRouterSettings = {
	openRouterSecretName: '',
	gatekeeperModel: 'deepseek/deepseek-v4-flash',
	defaultExecutorModel: 'moonshotai/kimi-k2.7-code',
	permittedExecutorModels: ['moonshotai/kimi-k2.7-code'],
	routingInstruction: 'Choose the best permitted executor model and, when useful, one available skill. Return only the required JSON object.',
	skillSearchPaths: ['05 Skills/Métodos', '05 Skills', '03 Projects/Héstia/05 Skills'],
	allowedGitHubRepos: [],
};

function splitLines(value: string): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }

export class SovereignRouterSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SovereignRouterPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Sovereign Router' });
		containerEl.createEl('p', { text: 'Messages and selected skills are sent to OpenRouter only when you send a chat message. No conversation is saved by this plugin.' });
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
	}

	private addTextSetting(name: string, description: string, value: string, onChange: (value: string) => Promise<void>): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addText((text) => text.setValue(value).onChange(async (newValue) => { await onChange(newValue.trim()); await this.plugin.saveSettings(); }));
	}
	private addTextAreaSetting(name: string, description: string, value: string, onChange: (value: string) => Promise<void>): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addTextArea((text) => text.setValue(value).onChange(async (newValue) => { await onChange(newValue); await this.plugin.saveSettings(); }));
	}
}
