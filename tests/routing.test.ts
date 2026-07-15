import * as assert from 'node:assert/strict';
import test from 'node:test';
import { parseGatekeeperDecision, selectRoute } from '../src/routing';
import type { SovereignRouterSettings } from '../src/settings';

const settings: SovereignRouterSettings = {
	openRouterSecretName: '',
	gatekeeperModel: 'deepseek/deepseek-v4-flash',
	defaultExecutorModel: 'moonshotai/kimi-k2.7-code',
	permittedExecutorModels: ['moonshotai/kimi-k2.7-code'],
	routingInstruction: '',
	skillSearchPaths: [],
	allowedGitHubRepos: [],
};

test('accepts a valid local route with a permitted model', () => {
	const decision = parseGatekeeperDecision({ model: 'moonshotai/kimi-k2.7-code', skill: { source: 'local', path: 'coding.md' } });
	assert.deepEqual(selectRoute(decision, settings), { model: 'moonshotai/kimi-k2.7-code', skill: { source: 'local', path: 'coding.md' }, note: null });
});
test('falls back for malformed responses and unpermitted models', () => {
	assert.equal(parseGatekeeperDecision({ model: 'x' }), null);
	const decision = parseGatekeeperDecision({ model: 'untrusted/model', skill: null });
	assert.equal(selectRoute(decision, settings).model, settings.defaultExecutorModel);
});
