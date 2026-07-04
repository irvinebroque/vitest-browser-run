import type { TestProject } from 'vitest/node';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	browserRunCdp,
	createBrowserRunCdpConnection,
	getBrowserRunApiToken,
	getBrowserRunWsEndpoint,
	resolveBrowserRunCdpOptions,
	resolveBrowserRunPoolOptions,
	resolveBrowserRunRunnerUrl,
} from '../src/browser-run.js';

const playwrightMocks = vi.hoisted(() => ({
	connectOverCDP: vi.fn(),
}));

vi.mock('playwright', () => ({
	chromium: {
		connectOverCDP: playwrightMocks.connectOverCDP,
	},
}));

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

describe('Browser Run CDP connector', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		playwrightMocks.connectOverCDP.mockReset();
		globalThis.fetch = originalFetch;
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
		})).toThrow('Missing CLOUDFLARE_ACCOUNT_ID');
	});

	it('requires an API token for Browser Run auth headers', () => {
		expect(() => getBrowserRunApiToken({ apiToken: '' })).toThrow('Missing CLOUDFLARE_API_TOKEN');
		expect(() => getBrowserRunApiToken({ apiToken: '' })).toThrow('Browser Rendering - Edit permission');
	});

	it('creates connectOverCDP options with Browser Run auth headers', () => {
		expect(createBrowserRunCdpConnection({
			accountId: 'account-id',
			apiToken: 'token',
			wsEndpoint: 'wss://example.com/devtools/browser',
			publicOrigin: 'https://runner.example.com',
			keepAliveMs: 600000,
			recording: false,
			pool: resolveBrowserRunPoolOptions({}),
		})).toEqual({
			wsEndpoint: 'wss://example.com/devtools/browser',
			headers: { Authorization: 'Bearer token' },
		});
	});

	it('resolves Browser Run options from env', () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'env-account');
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'env-token');
		vi.stubEnv('VITEST_BROWSER_PUBLIC_ORIGIN', 'https://runner.example.com');
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_KEEP_ALIVE_MS', '42');
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_RECORDING', 'true');

		expect(resolveBrowserRunCdpOptions({})).toMatchObject({
			accountId: 'env-account',
			apiToken: 'env-token',
			publicOrigin: 'https://runner.example.com',
			keepAliveMs: 42,
			recording: true,
		});
	});

	it('resolves Browser Run pool options from env', () => {
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS', '3');
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER', '4');
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS', '25');
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_ACQUIRE_TIMEOUT_MS', '5000');
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_RETRY_429', 'false');

		expect(resolveBrowserRunPoolOptions({})).toEqual({
			acquireIntervalMs: 25,
			acquireTimeoutMs: 5000,
			maxBrowsers: 3,
			retry429: false,
			sessionsPerBrowser: 4,
		});
	});

	it('prefers explicit pool options over env vars', () => {
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS', '3');
		vi.stubEnv('CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER', '4');

		expect(resolveBrowserRunPoolOptions({
			maxBrowsers: 2,
			sessionsPerBrowser: 8,
		})).toMatchObject({
			maxBrowsers: 2,
			sessionsPerBrowser: 8,
		});
	});

	it('rejects invalid pool values', () => {
		expect(() => resolveBrowserRunPoolOptions({ maxBrowsers: 0 })).toThrow('pool.maxBrowsers');
		expect(() => resolveBrowserRunPoolOptions({ sessionsPerBrowser: -1 })).toThrow('pool.sessionsPerBrowser');
		expect(() => resolveBrowserRunPoolOptions({ acquireIntervalMs: -1 })).toThrow('pool.acquireIntervalMs');
		expect(() => resolveBrowserRunPoolOptions({ acquireTimeoutMs: 0 })).toThrow('pool.acquireTimeoutMs');
	});

	it('prefers explicit credential options over env vars', () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'env-account');
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'env-token');

		expect(resolveBrowserRunCdpOptions({
			accountId: 'option-account',
			apiToken: 'option-token',
		})).toMatchObject({
			accountId: 'option-account',
			apiToken: 'option-token',
		});
	});

	it('uses Cloudflare tunnel URL as the fallback public origin', () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'env-account');
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'env-token');
		vi.stubEnv('VITEST_BROWSER_PUBLIC_ORIGIN', undefined);
		vi.stubEnv('CLOUDFLARE_TUNNEL_URL', 'https://tunnel.example.com');

		expect(resolveBrowserRunCdpOptions({})).toMatchObject({
			publicOrigin: 'https://tunnel.example.com',
		});
	});

	it('rejects multi-browser pooling with a fixed custom WebSocket endpoint', () => {
		expect(() => resolveBrowserRunCdpOptions({
			apiToken: 'token',
			wsEndpoint: 'wss://example.com/devtools/browser/session-id',
			pool: { maxBrowsers: 2, sessionsPerBrowser: 1 },
		})).toThrow('CLOUDFLARE_BROWSER_RUN_WS_ENDPOINT cannot be used');
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
		)).toThrow('Missing VITEST_BROWSER_PUBLIC_ORIGIN or CLOUDFLARE_TUNNEL_URL');
	});

	it('reads public origin lazily for Vite plugin tunnel startup', async () => {
		const { provider } = setupPooledProvider({
			publicOrigin: undefined,
			pool: { acquireIntervalMs: 0, maxBrowsers: 1, sessionsPerBrowser: 1 },
		}, 1);

		vi.stubEnv('VITEST_BROWSER_PUBLIC_ORIGIN', 'https://runner.example.com');
		await provider.openPage('session-1', 'http://127.0.0.1:63315/__vitest_test__/?sessionId=session-1', { parallel: false });

		const page = provider.getPage('session-1') as unknown as MockPage;
		expect(page.goto).toHaveBeenCalledWith('https://runner.example.com/__vitest_test__/?sessionId=session-1', { timeout: 0 });
	});

	it('reads the Cloudflare tunnel URL lazily for Vite plugin auto tunnels', async () => {
		const { provider } = setupPooledProvider({
			publicOrigin: undefined,
			pool: { acquireIntervalMs: 0, maxBrowsers: 1, sessionsPerBrowser: 1 },
		}, 1);

		vi.stubEnv('VITEST_BROWSER_PUBLIC_ORIGIN', undefined);
		vi.stubEnv('CLOUDFLARE_TUNNEL_URL', 'https://tunnel.example.com');
		await provider.openPage('session-1', 'http://127.0.0.1:63315/__vitest_test__/?sessionId=session-1', { parallel: false });

		const page = provider.getPage('session-1') as unknown as MockPage;
		expect(page.goto).toHaveBeenCalledWith('https://tunnel.example.com/__vitest_test__/?sessionId=session-1', { timeout: 0 });
	});

	it('routes Vitest sessions across Browser Run browsers by capacity', async () => {
		const { browsers, fetchCalls, provider } = setupPooledProvider({
			pool: { acquireIntervalMs: 0, maxBrowsers: 2, sessionsPerBrowser: 4 },
		}, 8);

		await Promise.all(Array.from({ length: 8 }, (_, index) => provider.openPage(
			`session-${index + 1}`,
			`http://127.0.0.1:63315/__vitest_test__/?sessionId=session-${index + 1}`,
			{ parallel: true },
		)));

		expect(playwrightMocks.connectOverCDP).toHaveBeenCalledTimes(2);
		expect(browsers).toHaveLength(2);
		expect(browsers[0]!.newContext).toHaveBeenCalledTimes(4);
		expect(browsers[1]!.newContext).toHaveBeenCalledTimes(4);
		expect(provider.getBrowserRunPoolMetadata('session-1')).toMatchObject({
			browserLeaseId: 1,
			browserLeaseIndex: 0,
			browserRunSessionId: 'browser-run-session-1',
			maxBrowsers: 2,
			sessionsPerBrowser: 4,
		});
		expect(provider.getBrowserRunPoolMetadata('session-8')).toMatchObject({
			browserLeaseId: 2,
			browserLeaseIndex: 1,
			browserRunSessionId: 'browser-run-session-2',
		});

		await provider.close();

		expect(fetchCalls.filter((call) => call.method === 'POST')).toHaveLength(2);
		expect(fetchCalls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
		expect(browsers[0]!.close).toHaveBeenCalledOnce();
		expect(browsers[1]!.close).toHaveBeenCalledOnce();
	});

	it('fails early when Vitest maxWorkers exceeds configured Browser Run pool capacity', async () => {
		const { provider } = setupPooledProvider({
			pool: { acquireIntervalMs: 0, maxBrowsers: 1, sessionsPerBrowser: 2 },
		}, 3);

		await expect(provider.openPage(
			'session-1',
			'http://127.0.0.1:63315/__vitest_test__/?sessionId=session-1',
			{ parallel: true },
		)).rejects.toThrow('Browser Run pool capacity (2) is lower than Vitest maxWorkers (3)');
	});

	it('retries Browser Run acquisition after a 429 response', async () => {
		const { fetchCalls, provider } = setupPooledProvider({
			pool: { acquireIntervalMs: 0, maxBrowsers: 1, retry429: true, sessionsPerBrowser: 1 },
		}, 1, { firstAcquireRateLimited: true });

		await provider.openPage(
			'session-1',
			'http://127.0.0.1:63315/__vitest_test__/?sessionId=session-1',
			{ parallel: false },
		);

		expect(fetchCalls.filter((call) => call.method === 'POST')).toHaveLength(2);
		expect(playwrightMocks.connectOverCDP).toHaveBeenCalledOnce();
	});

	it('uses a fixed custom WebSocket endpoint for a single Browser Run browser', async () => {
		const { fetchCalls, provider } = setupPooledProvider({
			wsEndpoint: 'wss://example.com/devtools/browser/session-id',
			pool: { acquireIntervalMs: 0, maxBrowsers: 1, sessionsPerBrowser: 2 },
		}, 2);

		await provider.openPage(
			'session-1',
			'http://127.0.0.1:63315/__vitest_test__/?sessionId=session-1',
			{ parallel: false },
		);

		expect(playwrightMocks.connectOverCDP).toHaveBeenCalledWith(
			'wss://example.com/devtools/browser/session-id',
			expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
		);
		expect(fetchCalls.filter((call) => call.method === 'POST')).toHaveLength(0);
	});
});

interface FetchCall {
	method: string;
	url: string;
}

interface MockBrowser {
	close: ReturnType<typeof vi.fn>;
	contexts: ReturnType<typeof vi.fn>;
	newContext: ReturnType<typeof vi.fn>;
}

interface MockPage {
	addInitScript: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	context: ReturnType<typeof vi.fn>;
	frame: ReturnType<typeof vi.fn>;
	frameLocator: ReturnType<typeof vi.fn>;
	goto: ReturnType<typeof vi.fn>;
}

function setupPooledProvider(options: Parameters<typeof browserRunCdp>[0], maxWorkers = 8, fetchOptions: { firstAcquireRateLimited?: boolean } = {}) {
	const browsers: MockBrowser[] = [];
	const fetchCalls: FetchCall[] = [];
	let acquireCount = 0;
	let rateLimited = fetchOptions.firstAcquireRateLimited ?? false;

	playwrightMocks.connectOverCDP.mockImplementation(async () => {
		const browser = createMockBrowser();
		browsers.push(browser);
		return browser;
	});

	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		fetchCalls.push({ method, url });

		if (method === 'POST') {
			if (rateLimited) {
				rateLimited = false;
				return new Response('rate limited', { headers: { 'Retry-After': '0' }, status: 429 });
			}

			acquireCount += 1;
			return Response.json({
				sessionId: `browser-run-session-${acquireCount}`,
				webSocketDebuggerUrl: `wss://api.cloudflare.com/client/v4/accounts/account-id/browser-rendering/devtools/browser/browser-run-session-${acquireCount}`,
			});
		}

		if (method === 'DELETE') {
			return Response.json({ status: 'closing' });
		}

		return new Response('ok');
	}) as typeof fetch;

	const providerOption = browserRunCdp({
		accountId: 'account-id',
		apiToken: 'token',
		publicOrigin: 'https://runner.example.com',
		...options,
	});
	const provider = providerOption.providerFactory(createMockProject(maxWorkers)) as ReturnType<typeof providerOption.providerFactory> & {
		getBrowserRunPoolMetadata: (sessionId: string) => Record<string, unknown> | undefined;
		getPage: (sessionId: string) => unknown;
	};

	return { browsers, fetchCalls, provider };
}

function createMockProject(maxWorkers: number): TestProject {
	return {
		name: 'browser-run-test-project',
		browser: {
			registerCommand: vi.fn(),
		},
		config: {
			browser: {
				headless: true,
				name: 'chromium',
				ui: false,
			},
			inspector: {
				enabled: false,
			},
			maxWorkers,
		},
		vitest: {
			config: {
				inspector: {
					enabled: false,
				},
			},
			logger: {
				console: {
					debug: vi.fn(),
				},
				log: vi.fn(),
				warn: vi.fn(),
			},
		},
	} as unknown as TestProject;
}

function createMockBrowser(): MockBrowser {
	const contexts: unknown[] = [];
	const browser: MockBrowser = {
		close: vi.fn(async () => {}),
		contexts: vi.fn(() => contexts),
		newContext: vi.fn(async () => {
			const context = createMockContext();
			contexts.push(context);
			return context;
		}),
	};
	return browser;
}

function createMockContext() {
	const cdpSession = {
		off: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		send: vi.fn(),
	};
	const context = {
		close: vi.fn(async () => {}),
		newCDPSession: vi.fn(async () => cdpSession),
		newPage: vi.fn(async () => page),
	};
	const page: MockPage = {
		addInitScript: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
		context: vi.fn(() => context),
		frame: vi.fn(() => null),
		frameLocator: vi.fn(() => ({ locator: vi.fn() })),
		goto: vi.fn(async () => {}),
	};
	return context;
}
