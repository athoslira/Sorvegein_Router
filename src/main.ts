import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_EXECUTOR_MODELS } from './models';
import { DEFAULT_SETTINGS, SovereignRouterSettingTab, SovereignRouterSettings } from './settings';
import { SovereignRouterView, VIEW_TYPE_SOVEREIGN_ROUTER } from './ui/chat-view';

export default class SovereignRouterPlugin extends Plugin {
	settings!: SovereignRouterSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_SOVEREIGN_ROUTER,
			(leaf) => new SovereignRouterView(leaf, this),
		);

		this.addRibbonIcon('bot', 'Open Sovereign Router', () => {
			void this.activateChatView();
		});
		this.addCommand({
			id: 'open-chat',
			name: 'Open chat',
			callback: () => void this.activateChatView(),
		});
		this.addSettingTab(new SovereignRouterSettingTab(this.app, this));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SOVEREIGN_ROUTER);
	}

	async loadSettings(): Promise<void> {
		const savedSettings = (await this.loadData()) as Partial<SovereignRouterSettings>;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			savedSettings,
		);
		if (savedSettings.modelCatalogVersion === undefined) {
			this.settings.permittedExecutorModels = Array.from(
				new Set([...DEFAULT_EXECUTOR_MODELS, ...(savedSettings.permittedExecutorModels ?? [])]),
			);
			this.settings.modelCatalogVersion = 1;
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async activateChatView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOVEREIGN_ROUTER)[0];
		const leaf = existingLeaf ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice('Could not open the Sovereign Router panel.');
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_SOVEREIGN_ROUTER, active: true });
		this.app.workspace.revealLeaf(leaf as WorkspaceLeaf);
	}
}
