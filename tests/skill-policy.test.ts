import * as assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedGitHubRepository, isSafeRelativePath } from '../src/skill-policy';

test('allows vault-relative skill paths only', () => {
	assert.equal(isSafeRelativePath('prompts/code.md'), true);
	assert.equal(isSafeRelativePath('../secrets.md'), false);
	assert.equal(isSafeRelativePath('C:\\secrets.md'), false);
	assert.equal(isSafeRelativePath('/etc/passwd'), false);
});
test('requires exact allowed GitHub repositories', () => {
	assert.equal(isAllowedGitHubRepository('owner/repo', ['owner/repo']), true);
	assert.equal(isAllowedGitHubRepository('owner/other', ['owner/repo']), false);
	assert.equal(isAllowedGitHubRepository('owner/repo/extra', ['owner/repo']), false);
});
