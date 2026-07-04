import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	browserRunCdp,
	createBrowserRunCdpConnection,
	getBrowserRunApiToken,
	getBrowserRunWsEndpoint,
	resolveBrowserRunCdpOptions,
	resolveBrowserRunRunnerUrl,
} from '../src/browser-run.js';

const originalEnv = { ...process.env };

describe('Browser Run CDP connector', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		process.env = { ...originalEnv };
	});

	it('constructs the Browser Run CDP endpoint with keep_alive', () => {
		expect(getBrowserRunWsEndpoint({
			accountId: 'account-id',
			keepAliveMs: 12345,
			recording: false,
			wsEndpoint: '',
		})).toBe('wss://api.cloudflare.com/client/v4/accounts/account-id/browser-rendering/devtools/browser?keep_alive=12345');
	});

	it('adds recording=true when recording is enabled', () => {
		const endpoint = new URL(getBrowserRunWsEndpoint({
			accountId: 'account-id',
			keepAliveMs: 600000,
			recording: true,
			wsEndpoint: '',
		}));

		expect(endpoint.searchParams.get('keep_alive')).toBe('600000');
		expect(endpoint.searchParams.get('recording')).toBe('true');
	});

	it('uses a custom WebSocket endpoint without requiring an account ID', () => {
		expect(getBrowserRunWsEndpoint({
			accountId: '',
			keepAliveMs: 600000,
			recording: true,
			wsEndpoint: 'wss://example.com/devtools/browser',
		})).toBe('wss://example.com/devtools/browser');
	});

	it('requires an account ID when no custom endpoint is configured', () => {
		expect(() => getBrowserRunWsEndpoint({
			accountId: '',
			keepAliveMs: 600000,
			recording: false,
			wsEndpoint: '',
		})).toThrow('Missing CF_ACCOUNT_ID');
	});

	it('requires an API token for Browser Run auth headers', () => {
		expect(() => getBrowserRunApiToken({ apiToken: '' })).toThrow('Missing CF_API_TOKEN');
	});

	it('creates connectOverCDP options with Browser Run auth headers', () => {
		expect(createBrowserRunCdpConnection({
			accountId: 'account-id',
			apiToken: 'token',
			wsEndpoint: 'wss://example.com/devtools/browser',
			publicOrigin: 'https://runner.example.com',
			keepAliveMs: 600000,
			recording: false,
		})).toEqual({
			wsEndpoint: 'wss://example.com/devtools/browser',
			headers: { Authorization: 'Bearer token' },
		});
	});

	it('resolves Browser Run options from env', () => {
		vi.stubEnv('CF_ACCOUNT_ID', 'env-account');
		vi.stubEnv('CF_API_TOKEN', 'env-token');
		vi.stubEnv('VITEST_BROWSER_PUBLIC_ORIGIN', 'https://runner.example.com');
		vi.stubEnv('CF_BROWSER_RUN_KEEP_ALIVE_MS', '42');
		vi.stubEnv('CF_BROWSER_RUN_RECORDING', 'true');

		expect(resolveBrowserRunCdpOptions({})).toMatchObject({
			accountId: 'env-account',
			apiToken: 'env-token',
			publicOrigin: 'https://runner.example.com',
			keepAliveMs: 42,
			recording: true,
		});
	});

	it('rewrites Browser Run runner URLs with the configured public origin', () => {
		expect(resolveBrowserRunRunnerUrl(
			'http://127.0.0.1:63315/__vitest_test__/?sessionId=abc',
			'https://runner.example.com/prefix',
		)).toBe('https://runner.example.com/prefix/__vitest_test__/?sessionId=abc');
	});

	it('reports missing public origin from the Browser Run connector', () => {
		expect(() => resolveBrowserRunRunnerUrl(
			'http://127.0.0.1:63315/__vitest_test__/?sessionId=abc',
			'',
		)).toThrow('Missing VITEST_BROWSER_PUBLIC_ORIGIN');
	});

	it('reads public origin lazily for Vite plugin tunnel startup', async () => {
		vi.stubEnv('CF_ACCOUNT_ID', 'env-account');
		vi.stubEnv('CF_API_TOKEN', 'env-token');

		const provider = browserRunCdp() as ReturnType<typeof browserRunCdp> & {
			options: {
				runner: {
					resolveUrl: (context: { url: string; sessionId: string; parallel: boolean; browserName: 'chromium' }) => string | Promise<string>;
				};
			};
		};

		vi.stubEnv('VITEST_BROWSER_PUBLIC_ORIGIN', 'https://runner.example.com');

		expect(await provider.options.runner.resolveUrl({
			url: 'http://127.0.0.1:63315/__vitest_test__/?sessionId=abc',
			sessionId: 'abc',
			parallel: false,
			browserName: 'chromium',
		})).toBe('https://runner.example.com/__vitest_test__/?sessionId=abc');
	});
});
