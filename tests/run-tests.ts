import * as assert from 'node:assert/strict';
import { buildDocumentContext, limitDocumentContent, MAX_DOCUMENT_CHARS } from '../src/document-context';
import { isSupportedDocument, isTextDocument, needsDoclingConversion } from '../src/document-files';
import { DEFAULT_EXECUTOR_MODELS, modelLabel } from '../src/models';
import { parseGatekeeperDecision, selectRoute } from '../src/routing';
import { isAllowedGitHubRepository, isSafeRelativePath } from '../src/skill-policy';
import { SseParser } from '../src/sse';
import type { SovereignRouterSettings } from '../src/settings';

const settings: SovereignRouterSettings = {
	openRouterSecretName: '',
	gatekeeperModel: 'deepseek/deepseek-v4-flash',
	defaultExecutorModel: 'moonshotai/kimi-k2.7-code',
	permittedExecutorModels: ['moonshotai/kimi-k2.7-code'],
	modelCatalogVersion: 1,
	routingInstruction: '',
	skillSearchPaths: [],
	allowedGitHubRepos: [],
	doclingServiceUrl: '',
	doclingSecretName: '',
};

function run(name: string, check: () => void): void {
	check();
	console.log(`✓ ${name}`);
}

run('validates permitted routes and fallback routes', () => {
	const valid = parseGatekeeperDecision({ model: settings.defaultExecutorModel, skill: { source: 'local', path: 'coding.md' } });
	assert.equal(selectRoute(valid, settings).note, null);
	assert.equal(parseGatekeeperDecision({ model: 'invalid' }), null);
	const unpermitted = parseGatekeeperDecision({ model: 'untrusted/model', skill: null });
	assert.equal(selectRoute(unpermitted, settings).model, settings.defaultExecutorModel);
});

run('blocks unsafe skill paths and unapproved GitHub repositories', () => {
	assert.equal(isSafeRelativePath('prompts/code.md'), true);
	assert.equal(isSafeRelativePath('../secret.md'), false);
	assert.equal(isSafeRelativePath('C:\\secret.md'), false);
	assert.equal(isAllowedGitHubRepository('owner/repo', ['owner/repo']), true);
	assert.equal(isAllowedGitHubRepository('owner/other', ['owner/repo']), false);
});

run('parses fragmented SSE data, comments, usage, and done events', () => {
	const parser = new SseParser();
	assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"Hel'), []);
	assert.deepEqual(parser.push('lo"}}]}\n\n: keepalive\n\ndata: [DONE]\n\n'), ['{"choices":[{"delta":{"content":"Hello"}}]}', '[DONE]']);
	parser.push('data: {"usage":{"cost":0.01}}');
	assert.deepEqual(parser.finish(), ['{"usage":{"cost":0.01}}']);
});

run('exposes the requested model catalogue with the canonical Kimi slug', () => {
	assert.equal(DEFAULT_EXECUTOR_MODELS.length, 6);
	assert.equal(DEFAULT_EXECUTOR_MODELS.includes('moonshotai/kimi-k2.7-code'), true);
	assert.equal(modelLabel('x-ai/grok-4.3'), 'Grok 4.3');
});

run('limits document context while preserving the attachment label', () => {
	const limited = limitDocumentContent('a'.repeat(MAX_DOCUMENT_CHARS + 1));
	assert.equal(limited.truncated, true);
	const context = buildDocumentContext([{ name: 'report.pdf', markdown: limited.content, truncated: true }]);
	assert.match(context || '', /Attached document: report.pdf/);
});

run('classifies vault files for local reading or Docling conversion', () => {
	assert.equal(isTextDocument('note.md'), true);
	assert.equal(needsDoclingConversion('report.pdf'), true);
	assert.equal(isSupportedDocument('slides.pptx'), true);
	assert.equal(isSupportedDocument('archive.zip'), false);
});
