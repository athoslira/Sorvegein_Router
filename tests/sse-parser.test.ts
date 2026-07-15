import * as assert from 'node:assert/strict';
import test from 'node:test';
import { SseParser } from '../src/sse';

test('buffers fragmented SSE data and ignores comments', () => {
	const parser = new SseParser();
	assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"Hel'), []);
	assert.deepEqual(parser.push('lo"}}]}\n\n: keepalive\n\ndata: [DONE]\n\n'), ['{"choices":[{"delta":{"content":"Hello"}}]}', '[DONE]']);
});
test('flushes a final event without a trailing blank line', () => {
	const parser = new SseParser();
	parser.push('data: {"usage":{"cost":0.01}}');
	assert.deepEqual(parser.finish(), ['{"usage":{"cost":0.01}}']);
});
