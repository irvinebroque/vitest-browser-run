import { describe, expectTypeOf, it } from 'vitest';

import { browserRunCdp, type BrowserRunCdpConnectOptions } from '../src/index.js';

describe('public Browser Run provider types', () => {
	it('accepts Browser Run connector options backed by @vitest/browser-playwright', () => {
		browserRunCdp({
			accountId: 'account-id',
			apiToken: 'token',
			keepAliveMs: 600000,
			recording: true,
		});
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
