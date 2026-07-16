export interface ModelOption {
	id: string;
	name: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
	{ id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
	{ id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
	{ id: 'qwen/qwen3.7-max', name: 'Qwen 3.7 Max' },
	{ id: 'qwen/qwen3.7-plus', name: 'Qwen 3.7 Plus' },
	{ id: 'moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code' },
	{ id: 'x-ai/grok-4.3', name: 'Grok 4.3' },
];

export const DEFAULT_EXECUTOR_MODELS = MODEL_OPTIONS.map((model) => model.id);

export function modelLabel(modelId: string): string {
	const model = MODEL_OPTIONS.find((option) => option.id === modelId);
	return model ? model.name : modelId;
}
