import type { SovereignRouterSettings } from './settings';
import type { GatekeeperDecision, RouteResult, SkillReference, VaultContextReference } from './types';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function parseSkill(value: unknown): SkillReference | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !isNonEmptyString(value.source) || !isNonEmptyString(value.path)) return undefined;
	if (value.source === 'local') return { source: 'local', path: value.path };
	if (value.source === 'github' && isNonEmptyString(value.repository) && isNonEmptyString(value.ref)) return { source: 'github', repository: value.repository, ref: value.ref, path: value.path };
	return undefined;
}
function parseContext(value: unknown): VaultContextReference | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || value.source !== 'vault' || !isNonEmptyString(value.query) || value.query.length > 600) return undefined;
	return { source: 'vault', query: value.query.trim() };
}
export function parseGatekeeperDecision(value: unknown): GatekeeperDecision | null {
	if (!isRecord(value) || !isNonEmptyString(value.model) || !Object.prototype.hasOwnProperty.call(value, 'skill')) return null;
	const skill = parseSkill(value.skill);
	const context = Object.prototype.hasOwnProperty.call(value, 'context') ? parseContext(value.context) : null;
	return skill === undefined || context === undefined ? null : { model: value.model.trim(), skill, context };
}
export function fallbackRoute(settings: SovereignRouterSettings, note: string): RouteResult { return { model: settings.defaultExecutorModel, skill: null, context: null, note }; }
export function selectRoute(decision: GatekeeperDecision | null, settings: SovereignRouterSettings): RouteResult {
	if (!decision) return fallbackRoute(settings, 'Gatekeeper response was invalid; using the default model.');
	if (!settings.permittedExecutorModels.includes(decision.model)) return fallbackRoute(settings, 'Gatekeeper selected a model outside the permitted list.');
	return { model: decision.model, skill: decision.skill, context: decision.context, note: null };
}
export function routingSystemPrompt(settings: SovereignRouterSettings): string {
	const localPaths = settings.skillSearchPaths.length ? settings.skillSearchPaths.join(', ') : 'none';
	const repos = settings.allowedGitHubRepos.length ? settings.allowedGitHubRepos.join(', ') : 'none';
	return [settings.routingInstruction, `Permitted executor models: ${settings.permittedExecutorModels.join(', ') || settings.defaultExecutorModel}.`, `Local skill folders: ${localPaths}.`, `Permitted GitHub repositories: ${repos}.`, 'A local vault context index is available. Request it only when the user needs information from their vault, using a short focused retrieval query.', 'Return only valid JSON with this exact shape: {"model":"permitted/model","skill":null|{"source":"local","path":"file.md"}|{"source":"github","repository":"owner/repo","ref":"branch-or-tag","path":"file.md"},"context":null|{"source":"vault","query":"focused retrieval query"}}.'].filter(Boolean).join('\n');
}
