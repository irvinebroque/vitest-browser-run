import type { BrowserProviderOption } from 'vitest/node';

import { browserCdp, type BrowserCdpConnectOptions, type BrowserCdpOptions } from './browser-cdp.js';
import { readBoolean, readNumber } from './env.js';
import { resolveBrowserRunnerUrl, waitForLocalBrowserRunner } from './runner-origin.js';

const cdpConnectAttempts = 3;
const browserRunPublicOriginEnv = 'VITEST_BROWSER_PUBLIC_ORIGIN';

export interface BrowserRunCdpOptions {
	accountId?: string;
	apiToken?: string;
	wsEndpoint?: string;
	publicOrigin?: string;
	keepAliveMs?: number;
	recording?: boolean;
	browserPerSession?: boolean;
	launchDelayMs?: number;
	logSessions?: boolean;
}

export interface ResolvedBrowserRunCdpOptions extends Required<BrowserRunCdpOptions> {}

export function browserRunCdp(options: BrowserRunCdpOptions = {}): BrowserProviderOption {
	return browserCdp({
		name: 'browser-run-cdp',
		runner: {
			resolveUrl: ({ url }) => resolveBrowserRunRunnerUrl(url, resolveBrowserRunCdpOptions(options).publicOrigin),
			waitForReady: ({ url }) => waitForLocalBrowserRunner(url),
		},
		browserPerSession: options.browserPerSession ?? readBoolean(process.env.CF_BROWSER_RUN_BROWSER_PER_SESSION, true, 'CF_BROWSER_RUN_BROWSER_PER_SESSION'),
		launchDelayMs: options.launchDelayMs ?? readNumber(process.env.CF_BROWSER_RUN_LAUNCH_DELAY_MS, 1100, 'CF_BROWSER_RUN_LAUNCH_DELAY_MS'),
		logSessions: options.logSessions ?? readBoolean(process.env.CF_BROWSER_RUN_LOG_SESSIONS, true, 'CF_BROWSER_RUN_LOG_SESSIONS'),
		contextStrategy: 'reuse-default-on-failure',
		connectRetry: {
			attempts: cdpConnectAttempts,
			shouldRetry: isTransientBrowserRunCdpConnectError,
			delayMs: (attempt) => Math.min(attempt * 2000, 5000),
		},
		connect: () => createBrowserRunCdpConnection(resolveBrowserRunCdpOptions(options)),
	} satisfies BrowserCdpOptions);
}

export function createBrowserRunCdpConnection(options: ResolvedBrowserRunCdpOptions): BrowserCdpConnectOptions {
	return {
		wsEndpoint: getBrowserRunWsEndpoint(options),
		headers: { Authorization: `Bearer ${getBrowserRunApiToken(options)}` },
	};
}

export function resolveBrowserRunCdpOptions(options: BrowserRunCdpOptions): ResolvedBrowserRunCdpOptions {
	return {
		accountId: options.accountId ?? process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		apiToken: options.apiToken ?? process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? '',
		wsEndpoint: options.wsEndpoint ?? process.env.CF_BROWSER_RUN_WS_ENDPOINT ?? '',
		publicOrigin: options.publicOrigin ?? process.env.VITEST_BROWSER_PUBLIC_ORIGIN ?? '',
		keepAliveMs: options.keepAliveMs ?? readNumber(process.env.CF_BROWSER_RUN_KEEP_ALIVE_MS, 600000, 'CF_BROWSER_RUN_KEEP_ALIVE_MS'),
		recording: options.recording ?? readBoolean(process.env.CF_BROWSER_RUN_RECORDING, false, 'CF_BROWSER_RUN_RECORDING'),
		browserPerSession: options.browserPerSession ?? readBoolean(process.env.CF_BROWSER_RUN_BROWSER_PER_SESSION, true, 'CF_BROWSER_RUN_BROWSER_PER_SESSION'),
		launchDelayMs: options.launchDelayMs ?? readNumber(process.env.CF_BROWSER_RUN_LAUNCH_DELAY_MS, 1100, 'CF_BROWSER_RUN_LAUNCH_DELAY_MS'),
		logSessions: options.logSessions ?? readBoolean(process.env.CF_BROWSER_RUN_LOG_SESSIONS, true, 'CF_BROWSER_RUN_LOG_SESSIONS'),
	};
}

export function resolveBrowserRunRunnerUrl(url: string, publicOrigin: string): string {
	if (!publicOrigin) {
		throw new Error(
			`Missing ${browserRunPublicOriginEnv}. Browser Run cannot reach localhost; expose Vitest's browser API with a tunnel and set its public origin.`,
		);
	}

	return resolveBrowserRunnerUrl(url, publicOrigin);
}

export function getBrowserRunWsEndpoint(options: Pick<ResolvedBrowserRunCdpOptions, 'accountId' | 'keepAliveMs' | 'recording' | 'wsEndpoint'>): string {
	if (options.wsEndpoint) {
		return options.wsEndpoint;
	}

	if (!options.accountId) {
		throw new Error('Missing CF_ACCOUNT_ID. Set CF_BROWSER_RUN_WS_ENDPOINT or CF_ACCOUNT_ID before running Browser Run tests.');
	}

	const endpoint = new URL(`wss://api.cloudflare.com/client/v4/accounts/${options.accountId}/browser-rendering/devtools/browser`);
	endpoint.searchParams.set('keep_alive', String(options.keepAliveMs));

	if (options.recording) {
		endpoint.searchParams.set('recording', 'true');
	}

	return endpoint.href;
}

export function getBrowserRunApiToken(options: Pick<ResolvedBrowserRunCdpOptions, 'apiToken'>): string {
	if (!options.apiToken) {
		throw new Error('Missing CF_API_TOKEN. Create a token with Browser Rendering - Edit permission before running Browser Run tests.');
	}

	return options.apiToken;
}

export function isTransientBrowserRunCdpConnectError(error: unknown): boolean {
	const message = String(error);
	return (
		message.includes('410 Gone')
		|| message.includes('Browser not running')
		|| message.includes('state: unhealthy')
		|| message.includes('WebSocket was closed before the connection was established')
		|| message.includes('ECONNRESET')
		|| message.includes('ETIMEDOUT')
	);
}
