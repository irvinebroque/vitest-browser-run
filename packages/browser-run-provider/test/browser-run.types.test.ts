import { describe, expectTypeOf, it } from 'vitest';

import { browserRunCdp, type BrowserRunCdpConnectOptions, type BrowserRunPoolOptions } from '../src/index.js';

describe('public Browser Run provider types', () => {
	it('accepts Browser Run connector options backed by @vitest/browser-playwright', () => {
		browserRunCdp({
			accountId: 'account-id',
			apiToken: 'token',
			keepAliveMs: 600000,
			recording: true,
			pool: {
				acquireIntervalMs: 1000,
				acquireTimeoutMs: 180000,
				maxBrowsers: 10,
				prewarm: true,
				retry429: true,
				sessionsPerBrowser: 4,
			},
		});
	});

	it('exposes Browser Run pool options', () => {
		const options = {
			maxBrowsers: 2,
			prewarm: 1,
			sessionsPerBrowser: 4,
		} satisfies BrowserRunPoolOptions;

		expectTypeOf(options.maxBrowsers).toEqualTypeOf<number>();
	});

	it('exposes Playwright CDP connect options', () => {
		const options = {
			wsEndpoint: 'wss://example.com/devtools/browser',
			headers: { Authorization: 'Bearer token' },
			timeout: 30_000,
		} satisfies BrowserRunCdpConnectOptions;

		expectTypeOf(options.wsEndpoint).toEqualTypeOf<string>();
	});
});
