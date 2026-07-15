import type { SovereignRouterSettings } from './settings';
import type { GatekeeperDecision, RouteResult, SkillReference } from './types';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function parseSkill(value: unknown): SkillReference | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !isNonEmptyString(value.source) || !isNonEmptyString(value.path)) return undefined;
	if (value.source === 'local') return { source: 'local', path: value.path };
	if (value.source === 'github' && isNonEmptyString(value.repository) && isNonEmptyString(value.ref)) return { source: 'github', repository: value.repository, ref: value.ref, path: value.path };
	return undefined;
}
export function parseGatekeeperDecision(value: unknown): GatekeeperDecision | null {
	if (!isRecord(value) || !isNonEmptyString(value.model) || !Object.prototype.hasOwnProperty.call(value, 'skill')) return null;
	const skill = parseSkill(value.skill);
	return skill === undefined ? null : { model: value.model.trim(), skill };
}
export function fallbackRoute(settings: SovereignRouterSettings, note: string): RouteResult { return { model: settings.defaultExecutorModel, skill: null, note }; }
export function selectRoute(decision: GatekeeperDecision | null, settings: SovereignRouterSettings): RouteResult {
	if (!decision) return fallbackRoute(settings, 'Gatekeeper response was invalid; using the default model.');
	if (!settings.permittedExecutorModels.includes(decision.model)) return fallbackRoute(settings, 'Gatekeeper selected a model outside the permitted list.');
	return { model: decision.model, skill: decision.skill, note: null };
}
export function routingSystemPrompt(settings: SovereignRouterSettings): string {
	const localPaths = settings.skillSearchPaths.length ? settings.skillSearchPaths.join(', ') : 'none';
	const repos = settings.allowedGitHubRepos.length ? settings.allowedGitHubRepos.join(', ') : 'none';
	return [settings.routingInstruction, `Permitted executor models: ${settings.permittedExecutorModels.join(', ') || settings.defaultExecutorModel}.`, `Local skill folders: ${localPaths}.`, `Permitted GitHub repositories: ${repos}.`, 'Return only valid JSON with this exact shape: {"model":"permitted/model","skill":null|{"source":"local","path":"file.md"}|{"source":"github","repository":"owner/repo","ref":"branch-or-tag","path":"file.md"}}.'].filter(Boolean).join('\n');
}
