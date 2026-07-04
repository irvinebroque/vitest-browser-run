import type { BrowserProviderOption } from 'vitest/node';

import { playwright, type PlaywrightProviderOptions } from '@vitest/browser-playwright';

import { readBoolean, readNumber } from './env.js';
import { resolveBrowserRunnerUrl, waitForLocalBrowserRunner } from './runner-origin.js';

const browserRunPublicOriginEnv = 'VITEST_BROWSER_PUBLIC_ORIGIN';
const cloudflareTunnelUrlEnv = 'CLOUDFLARE_TUNNEL_URL';
const cloudflareAccountIdEnv = 'CLOUDFLARE_ACCOUNT_ID';
const cloudflareApiTokenEnv = 'CLOUDFLARE_API_TOKEN';
const cloudflareBrowserRunWsEndpointEnv = 'CLOUDFLARE_BROWSER_RUN_WS_ENDPOINT';
const cloudflareBrowserRunKeepAliveMsEnv = 'CLOUDFLARE_BROWSER_RUN_KEEP_ALIVE_MS';
const cloudflareBrowserRunRecordingEnv = 'CLOUDFLARE_BROWSER_RUN_RECORDING';

export type BrowserRunCdpConnectOptions = NonNullable<PlaywrightProviderOptions['connectOverCDPOptions']>;

export interface BrowserRunCdpOptions {
	/** Cloudflare account ID. Prefer CLOUDFLARE_ACCOUNT_ID for normal use. */
	accountId?: string;
	/** Cloudflare API token with Browser Rendering - Edit permission. Prefer CLOUDFLARE_API_TOKEN for normal use. */
	apiToken?: string;
	wsEndpoint?: string;
	publicOrigin?: string;
	keepAliveMs?: number;
	recording?: boolean;
}

export interface ResolvedBrowserRunCdpOptions extends Required<BrowserRunCdpOptions> {}

export function browserRunCdp(options: BrowserRunCdpOptions = {}): BrowserProviderOption {
	const resolvedOptions = resolveBrowserRunCdpOptions(options);

	return playwright({
		connectOverCDPOptions: createBrowserRunCdpConnection(resolvedOptions),
		runner: {
			resolveUrl: ({ url }) => resolveBrowserRunRunnerUrl(url, getBrowserRunPublicOrigin(options)),
			waitForReady: ({ url }) => waitForBrowserRunRunnerReady(url, options),
		},
		contextStrategy: 'reuse-default-on-failure',
	} satisfies PlaywrightProviderOptions);
}

async function waitForBrowserRunRunnerReady(url: string, options: BrowserRunCdpOptions): Promise<void> {
	await waitForLocalBrowserRunner(url);
	await waitForBrowserRunPublicOrigin(options);
	await waitForLocalBrowserRunner(url, { attempts: 120, intervalMs: 500 });
}

async function waitForBrowserRunPublicOrigin(options: BrowserRunCdpOptions): Promise<string> {
	for (let attempt = 1; attempt <= 120; attempt += 1) {
		const publicOrigin = getBrowserRunPublicOrigin(options);
		if (publicOrigin) {
			return publicOrigin;
		}

		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	return getBrowserRunPublicOrigin(options);
}

function getBrowserRunPublicOrigin(options: BrowserRunCdpOptions): string {
	return options.publicOrigin ?? process.env[browserRunPublicOriginEnv] ?? process.env[cloudflareTunnelUrlEnv] ?? '';
}

export function createBrowserRunCdpConnection(options: ResolvedBrowserRunCdpOptions): BrowserRunCdpConnectOptions {
	return {
		wsEndpoint: getBrowserRunWsEndpoint(options),
		headers: { Authorization: `Bearer ${getBrowserRunApiToken(options)}` },
	};
}

export function resolveBrowserRunCdpOptions(options: BrowserRunCdpOptions): ResolvedBrowserRunCdpOptions {
	return {
		accountId: options.accountId ?? process.env[cloudflareAccountIdEnv] ?? '',
		apiToken: options.apiToken ?? process.env[cloudflareApiTokenEnv] ?? '',
		wsEndpoint: options.wsEndpoint ?? process.env[cloudflareBrowserRunWsEndpointEnv] ?? '',
		publicOrigin: options.publicOrigin ?? process.env[browserRunPublicOriginEnv] ?? process.env[cloudflareTunnelUrlEnv] ?? '',
		keepAliveMs: options.keepAliveMs ?? readNumber(process.env[cloudflareBrowserRunKeepAliveMsEnv], 600000, cloudflareBrowserRunKeepAliveMsEnv),
		recording: options.recording ?? readBoolean(process.env[cloudflareBrowserRunRecordingEnv], false, cloudflareBrowserRunRecordingEnv),
	};
}

export function resolveBrowserRunRunnerUrl(url: string, publicOrigin: string): string {
	if (!publicOrigin) {
		throw new Error(
			`Missing ${browserRunPublicOriginEnv} or ${cloudflareTunnelUrlEnv}. Browser Run cannot reach localhost; expose Vitest's browser API with a tunnel and set its public origin.`,
		);
	}

	return resolveBrowserRunnerUrl(url, publicOrigin);
}

export function getBrowserRunWsEndpoint(options: Pick<ResolvedBrowserRunCdpOptions, 'accountId' | 'keepAliveMs' | 'recording' | 'wsEndpoint'>): string {
	if (options.wsEndpoint) {
		return options.wsEndpoint;
	}

	if (!options.accountId) {
		throw new Error(
			`Missing ${cloudflareAccountIdEnv}. Set ${cloudflareAccountIdEnv} in .env or your shell before running Browser Run tests. `
			+ `You can also pass accountId to browserRunCdp() or set ${cloudflareBrowserRunWsEndpointEnv} to bypass account-scoped URL construction.`,
		);
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
		throw new Error(
			`Missing ${cloudflareApiTokenEnv}. Set ${cloudflareApiTokenEnv} in .env or your shell before running Browser Run tests. `
			+ 'The token needs Browser Rendering - Edit permission. You can also pass apiToken to browserRunCdp().',
		);
	}

	return options.apiToken;
}
