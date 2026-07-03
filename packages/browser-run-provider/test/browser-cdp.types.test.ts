import { describe, expectTypeOf, it } from 'vitest';

import {
	browserCdp,
	browserRunCdp,
	type BrowserCdpConnectOptions,
	type BrowserCdpRunnerContext,
} from '../src/index.js';

describe('public provider types', () => {
	it('accepts generic CDP connect and runner callbacks', () => {
		browserCdp({
			connect: async ({ sessionId, parallel }) => {
				expectTypeOf(sessionId).toEqualTypeOf<string>();
				expectTypeOf(parallel).toEqualTypeOf<boolean>();

				return {
					wsEndpoint: `wss://example.com/${sessionId}`,
					headers: { 'x-session': sessionId },
					timeout: 30_000,
				} satisfies BrowserCdpConnectOptions;
			},
			runner: {
				resolveUrl: async (context) => {
					expectTypeOf(context).toEqualTypeOf<BrowserCdpRunnerContext>();
					return context.url;
				},
				waitForReady: async ({ url }) => {
					expectTypeOf(url).toEqualTypeOf<string>();
				},
			},
		});
	});

	it('accepts the Browser Run connector defaults', () => {
		browserRunCdp({
			accountId: 'account-id',
			apiToken: 'token',
			keepAliveMs: 600000,
			recording: true,
		});
	});
});
