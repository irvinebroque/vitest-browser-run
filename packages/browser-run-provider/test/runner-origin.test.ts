import { describe, expect, it } from 'vitest';

import { resolveBrowserRunnerPublicOrigin, resolveBrowserRunnerUrl } from '../src/runner-origin.js';

describe('runner-origin helpers', () => {
	it('returns the Vitest browser runner URL unchanged without a public origin', () => {
		const localUrl = 'http://127.0.0.1:63315/__vitest_test__/?sessionId=abc';

		expect(resolveBrowserRunnerUrl(localUrl, '')).toBe(localUrl);
	});

	it('rewrites a local runner URL to a public origin', () => {
		expect(resolveBrowserRunnerUrl(
			'http://127.0.0.1:63315/__vitest_test__/?sessionId=abc',
			'https://runner.example.com',
		)).toBe('https://runner.example.com/__vitest_test__/?sessionId=abc');
	});

	it('preserves a public origin path prefix', () => {
		expect(resolveBrowserRunnerUrl(
			'http://localhost:63315/__vitest_test__/suite?sessionId=abc',
			'https://runner.example.com/prefix/',
		)).toBe('https://runner.example.com/prefix/__vitest_test__/suite?sessionId=abc');
	});

	it('resolves lazy public origins', () => {
		expect(resolveBrowserRunnerPublicOrigin(() => 'https://runner.example.com')).toBe('https://runner.example.com');
		expect(resolveBrowserRunnerPublicOrigin(undefined)).toBe('');
	});
});
