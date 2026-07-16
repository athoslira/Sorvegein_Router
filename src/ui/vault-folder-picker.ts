import { App, FuzzySuggestModal, TFolder } from 'obsidian';

export class VaultFolderPicker extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly onSelect: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder('Select a vault folder to attach');
	}

	getItems(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder && !file.path.startsWith('.obsidian'));
	}

	getItemText(folder: TFolder): string {
		return folder.path || '/';
	}

	onChooseItem(folder: TFolder): void {
		this.onSelect(folder);
	}
}
