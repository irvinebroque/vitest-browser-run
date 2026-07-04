import type { BrowserProviderOption, CDPSession, TestProject } from 'vitest/node';

import {
	playwright as vitestPlaywright,
	PlaywrightBrowserProvider,
	type PlaywrightContextStrategy,
	type PlaywrightProviderOptions,
} from '@vitest/browser-playwright';

import { readBoolean, readNumber } from './env.js';
import { resolveBrowserRunnerUrl, waitForLocalBrowserRunner } from './runner-origin.js';

type Browser = any;
type BrowserContext = any;
type BrowserContextOptions = Record<string, unknown>;
type Page = any;

const browserRunPublicOriginEnv = 'VITEST_BROWSER_PUBLIC_ORIGIN';
const cloudflareTunnelUrlEnv = 'CLOUDFLARE_TUNNEL_URL';
const cloudflareAccountIdEnv = 'CLOUDFLARE_ACCOUNT_ID';
const cloudflareApiTokenEnv = 'CLOUDFLARE_API_TOKEN';
const cloudflareBrowserRunWsEndpointEnv = 'CLOUDFLARE_BROWSER_RUN_WS_ENDPOINT';
const cloudflareBrowserRunKeepAliveMsEnv = 'CLOUDFLARE_BROWSER_RUN_KEEP_ALIVE_MS';
const cloudflareBrowserRunRecordingEnv = 'CLOUDFLARE_BROWSER_RUN_RECORDING';
const cloudflareBrowserRunMaxBrowsersEnv = 'CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS';
const cloudflareBrowserRunSessionsPerBrowserEnv = 'CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER';
const cloudflareBrowserRunAcquireIntervalMsEnv = 'CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS';
const cloudflareBrowserRunAcquireTimeoutMsEnv = 'CLOUDFLARE_BROWSER_RUN_ACQUIRE_TIMEOUT_MS';
const cloudflareBrowserRunRetry429Env = 'CLOUDFLARE_BROWSER_RUN_RETRY_429';

type BrowserRunCdpConnection = NonNullable<PlaywrightProviderOptions['connectOverCDPOptions']>;

export type BrowserRunCdpConnectOptions = BrowserRunCdpConnection;

export interface BrowserRunPoolOptions {
	/** Maximum Browser Run browser sessions to acquire. */
	maxBrowsers?: number;
	/** Maximum Vitest browser sessions/pages per Browser Run browser. Use 0 for no per-browser cap. */
	sessionsPerBrowser?: number;
	/** Minimum time between new Browser Run browser acquisitions. */
	acquireIntervalMs?: number;
	/** Maximum time to spend acquiring a Browser Run browser before failing. */
	acquireTimeoutMs?: number;
	/** Retry Browser Run 429 responses using Retry-After when possible. */
	retry429?: boolean;
}

export interface ResolvedBrowserRunPoolOptions extends Required<BrowserRunPoolOptions> {}

export interface BrowserRunCdpOptions {
	/** Cloudflare account ID. Prefer CLOUDFLARE_ACCOUNT_ID for normal use. */
	accountId?: string;
	/** Cloudflare API token with Browser Rendering - Edit permission. Prefer CLOUDFLARE_API_TOKEN for normal use. */
	apiToken?: string;
	/** Custom Browser Run CDP WebSocket endpoint. Pooling with more than one browser requires accountId instead. */
	wsEndpoint?: string;
	publicOrigin?: string;
	keepAliveMs?: number;
	recording?: boolean;
	pool?: BrowserRunPoolOptions;
}

export interface ResolvedBrowserRunCdpOptions extends Omit<Required<BrowserRunCdpOptions>, 'pool'> {
	pool: ResolvedBrowserRunPoolOptions;
}

interface BrowserRunLease {
	id: number;
	browser: Browser;
	browserRunSessionId: string;
	activeSessionIds: Set<string>;
	closed: boolean;
}

interface BrowserRunAcquireResult {
	browser: Browser;
	browserRunSessionId: string;
}

interface BrowserRunSessionResponse {
	sessionId?: string;
	webSocketDebuggerUrl?: string;
}

const unlimitedSessionsPerBrowser = 0;

export function browserRunCdp(options: BrowserRunCdpOptions = {}): BrowserProviderOption<BrowserRunCdpOptions> {
	const resolvedOptions = resolveBrowserRunCdpOptions(options);
	const base = vitestPlaywright();

	return {
		...base,
		name: 'playwright',
		supportedBrowser: ['chromium'],
		options: resolvedOptions,
		providerFactory(project) {
			return new BrowserRunCdpProvider(project, options, resolvedOptions);
		},
	};
}

export class BrowserRunCdpProvider extends PlaywrightBrowserProvider {
	private readonly sourceOptions: BrowserRunCdpOptions;
	private readonly browserRunOptions: ResolvedBrowserRunCdpOptions;
	private readonly leases: BrowserRunLease[] = [];
	private readonly sessionLeases = new Map<string, BrowserRunLease>();
	private readonly sessionMetadata = new Map<string, Record<string, unknown>>();
	private reserveQueue: Promise<void> = Promise.resolve();
	private lastAcquireAt = 0;
	private nextLeaseId = 1;
	private closingProvider = false;
	private capacityValidated = false;

	constructor(project: TestProject, sourceOptions: BrowserRunCdpOptions, resolvedOptions: ResolvedBrowserRunCdpOptions) {
		super(project, createBasePlaywrightOptions(resolvedOptions));
		this.sourceOptions = sourceOptions;
		this.browserRunOptions = resolvedOptions;
	}

	async openPage(sessionId: string, url: string, options: { parallel: boolean }): Promise<void> {
		this.validateProjectCapacity();
		this.throwIfClosing();

		if (this.pages.has(sessionId)) {
			await this.closeSessionResources(sessionId);
		}

		const lease = await this.reserveLease(sessionId);
		let context: BrowserContext | undefined;
		let page: Page | undefined;

		try {
			context = await this.createBrowserRunContext(lease);
			page = await context.newPage();
			await page.addInitScript({ content: this.createPoolMetadataScript(sessionId, lease) });

			this.contexts.set(sessionId, context as never);
			this.pages.set(sessionId, page as never);

			await waitForBrowserRunRunnerReady(url, this.sourceOptions);
			this.throwIfClosing();

			const resolvedUrl = resolveBrowserRunRunnerUrl(url, getBrowserRunPublicOrigin(this.sourceOptions));
			await page.goto(resolvedUrl, { timeout: 0 });
		}
		catch (error) {
			await page?.close().catch(() => {});
			await this.closeContextIfOwned(context).catch(() => {});
			this.pages.delete(sessionId);
			this.contexts.delete(sessionId);
			this.releaseLease(sessionId, lease);
			throw error;
		}
	}

	async getCDPSession(sessionId: string): Promise<CDPSession> {
		const page = this.getPage(sessionId);
		const cdp = await page.context().newCDPSession(page);
		return {
			send: cdp.send.bind(cdp),
			on: cdp.on.bind(cdp),
			off: cdp.off.bind(cdp),
			once: cdp.once.bind(cdp),
		} as CDPSession;
	}

	getBrowserRunPoolMetadata(sessionId: string): Record<string, unknown> | undefined {
		return this.sessionMetadata.get(sessionId);
	}

	async close(): Promise<void> {
		if (this.closingProvider) {
			return;
		}

		this.closingProvider = true;
		await super.close();

		await Promise.all(this.leases.map(async (lease) => {
			if (lease.closed) {
				return;
			}

			lease.closed = true;
			await lease.browser.close().catch(() => {});
			await this.closeBrowserRunSession(lease.browserRunSessionId).catch(() => {});
		}));

		this.leases.length = 0;
		this.sessionLeases.clear();
		this.sessionMetadata.clear();
	}

	private validateProjectCapacity(): void {
		if (this.capacityValidated) {
			return;
		}

		this.capacityValidated = true;
		const sessionsPerBrowser = this.getSessionsPerBrowser();
		if (!Number.isFinite(sessionsPerBrowser)) {
			return;
		}

		const capacity = this.browserRunOptions.pool.maxBrowsers * sessionsPerBrowser;
		const maxWorkers = this.getProjectMaxWorkers();
		if (maxWorkers > capacity) {
			throw new Error(
				`Browser Run pool capacity (${capacity}) is lower than Vitest maxWorkers (${maxWorkers}). `
				+ `Increase ${cloudflareBrowserRunMaxBrowsersEnv}, increase ${cloudflareBrowserRunSessionsPerBrowserEnv}, or lower maxWorkers.`,
			);
		}
	}

	private getProjectMaxWorkers(): number {
		const project = (this as unknown as { project?: TestProject }).project;
		const projectValue = Number(project?.config.maxWorkers);
		return Number.isFinite(projectValue) && projectValue > 0 ? projectValue : 1;
	}

	private async reserveLease(sessionId: string): Promise<BrowserRunLease> {
		const existing = this.sessionLeases.get(sessionId);
		if (existing) {
			return existing;
		}

		let reserved!: BrowserRunLease;
		this.reserveQueue = this.reserveQueue.then(async () => {
			this.throwIfClosing();

			const lease = this.findLeaseWithCapacity();
			if (lease) {
				lease.activeSessionIds.add(sessionId);
				this.sessionLeases.set(sessionId, lease);
				reserved = lease;
				return;
			}

			if (this.leases.length >= this.browserRunOptions.pool.maxBrowsers) {
				const capacity = this.getCapacityDescription();
				throw new Error(`Browser Run pool is exhausted (${capacity}). Lower maxWorkers or increase Browser Run pool limits.`);
			}

			const acquired = await this.acquireBrowser();
			const nextLease: BrowserRunLease = {
				id: this.nextLeaseId,
				browser: acquired.browser,
				browserRunSessionId: acquired.browserRunSessionId,
				activeSessionIds: new Set([sessionId]),
				closed: false,
			};
			this.nextLeaseId += 1;
			this.leases.push(nextLease);
			this.sessionLeases.set(sessionId, nextLease);
			reserved = nextLease;
		});

		await this.reserveQueue;
		return reserved;
	}

	private findLeaseWithCapacity(): BrowserRunLease | undefined {
		const sessionsPerBrowser = this.getSessionsPerBrowser();
		return this.leases.find((lease) => !lease.closed && lease.activeSessionIds.size < sessionsPerBrowser);
	}

	private getSessionsPerBrowser(): number {
		const configured = this.browserRunOptions.pool.sessionsPerBrowser;
		return configured === unlimitedSessionsPerBrowser ? Number.POSITIVE_INFINITY : configured;
	}

	private getCapacityDescription(): string {
		const sessionsPerBrowser = this.getSessionsPerBrowser();
		return Number.isFinite(sessionsPerBrowser)
			? `${this.browserRunOptions.pool.maxBrowsers} browsers x ${sessionsPerBrowser} sessions/browser`
			: `${this.browserRunOptions.pool.maxBrowsers} browsers x unlimited sessions/browser`;
	}

	private async acquireBrowser(): Promise<BrowserRunAcquireResult> {
		if (this.browserRunOptions.wsEndpoint) {
			if (this.browserRunOptions.pool.maxBrowsers > 1) {
				throw new Error(
					`${cloudflareBrowserRunWsEndpointEnv} cannot be used with Browser Run pooling above one browser. `
					+ `Unset ${cloudflareBrowserRunWsEndpointEnv} and use ${cloudflareAccountIdEnv} so the provider can acquire multiple Browser Run sessions.`,
				);
			}

			return {
				browser: await this.connectOverCdp(this.browserRunOptions.wsEndpoint),
				browserRunSessionId: '',
			};
		}

		const session = await this.acquireBrowserRunSession();
		const wsEndpoint = session.webSocketDebuggerUrl ?? getBrowserRunSessionWsEndpoint(this.browserRunOptions, session.sessionId!);
		return {
			browser: await this.connectOverCdp(wsEndpoint),
			browserRunSessionId: session.sessionId ?? '',
		};
	}

	private async acquireBrowserRunSession(): Promise<BrowserRunSessionResponse> {
		const accountId = getBrowserRunAccountId(this.browserRunOptions);
		const apiToken = getBrowserRunApiToken(this.browserRunOptions);
		const startedAt = Date.now();
		let lastError: unknown;

		while (Date.now() - startedAt <= this.browserRunOptions.pool.acquireTimeoutMs) {
			await this.waitForAcquireSlot();

			const response = await fetch(getBrowserRunSessionApiUrl(accountId, this.browserRunOptions), {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiToken}`,
				},
			});

			if (response.status === 429 && this.browserRunOptions.pool.retry429) {
				lastError = new Error('Browser Run acquisition was rate limited.');
				await response.body?.cancel().catch(() => {});
				await delay(readRetryAfterMs(response.headers.get('Retry-After')) ?? this.browserRunOptions.pool.acquireIntervalMs);
				continue;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => response.statusText);
				throw new Error(`Browser Run session acquisition failed with HTTP ${response.status}: ${message}`);
			}

			const result = normalizeBrowserRunSessionResponse(await response.json());
			if (!result.sessionId && !result.webSocketDebuggerUrl) {
				throw new Error('Browser Run session acquisition succeeded but did not return sessionId or webSocketDebuggerUrl.');
			}

			this.lastAcquireAt = Date.now();
			return result;
		}

		throw new Error(`Timed out acquiring a Browser Run session after ${this.browserRunOptions.pool.acquireTimeoutMs}ms.`, { cause: lastError });
	}

	private async waitForAcquireSlot(): Promise<void> {
		const intervalMs = this.browserRunOptions.pool.acquireIntervalMs;
		if (intervalMs <= 0 || this.lastAcquireAt === 0) {
			return;
		}

		const waitMs = intervalMs - (Date.now() - this.lastAcquireAt);
		if (waitMs > 0) {
			await delay(waitMs);
		}
	}

	private async connectOverCdp(wsEndpoint: string): Promise<Browser> {
		const playwright = await import('playwright');
		return playwright.chromium.connectOverCDP(wsEndpoint, {
			headers: { Authorization: `Bearer ${getBrowserRunApiToken(this.browserRunOptions)}` },
		});
	}

	private async createBrowserRunContext(lease: BrowserRunLease): Promise<BrowserContext> {
		const options = this.getBrowserRunContextOptions();
		try {
			return await lease.browser.newContext(options);
		}
		catch (error) {
			if (this.getSessionsPerBrowser() > 1) {
				throw new Error(
					'Browser Run could not create an isolated browser context while sessionsPerBrowser is greater than 1. '
					+ 'Lower CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER to 1 or use a Browser Run session that supports browser.newContext().',
					{ cause: error },
				);
			}

			const context = lease.browser.contexts()[0];
			if (!context) {
				throw new Error('Browser Run could not create a browser context and no default context is available.', { cause: error });
			}

			return context;
		}
	}

	private getBrowserRunContextOptions(): BrowserContextOptions {
		return { ignoreHTTPSErrors: true };
	}

	private async closeSessionResources(sessionId: string): Promise<void> {
		const page = this.pages.get(sessionId);
		const context = this.contexts.get(sessionId);
		this.pages.delete(sessionId);
		this.contexts.delete(sessionId);
		await page?.close().catch(() => {});
		await this.closeContextIfOwned(context).catch(() => {});
	}

	private async closeContextIfOwned(context: BrowserContext | undefined): Promise<void> {
		if (!context) {
			return;
		}

		const stillUsed = Array.from(this.contexts.values()).some((item) => item === context);
		if (!stillUsed) {
			await context.close();
		}
	}

	private releaseLease(sessionId: string, lease: BrowserRunLease): void {
		lease.activeSessionIds.delete(sessionId);
		this.sessionLeases.delete(sessionId);
		this.sessionMetadata.delete(sessionId);
	}

	private createPoolMetadataScript(sessionId: string, lease: BrowserRunLease): string {
		const sessionsPerBrowser = this.getSessionsPerBrowser();
		const metadata = {
			browserLeaseId: lease.id,
			browserLeaseIndex: this.leases.indexOf(lease),
			browserRunSessionId: lease.browserRunSessionId,
			maxBrowsers: this.browserRunOptions.pool.maxBrowsers,
			sessionId,
			sessionsPerBrowser: Number.isFinite(sessionsPerBrowser) ? sessionsPerBrowser : null,
		};
		this.sessionMetadata.set(sessionId, metadata);

		return `Object.defineProperty(globalThis, '__CLOUDFLARE_BROWSER_RUN_POOL__', { configurable: true, value: ${JSON.stringify(metadata)} });`;
	}

	private async closeBrowserRunSession(sessionId: string): Promise<void> {
		if (!sessionId || this.browserRunOptions.wsEndpoint) {
			return;
		}

		const response = await fetch(getBrowserRunSessionDeleteUrl(getBrowserRunAccountId(this.browserRunOptions), sessionId), {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${getBrowserRunApiToken(this.browserRunOptions)}`,
			},
		});
		await response.body?.cancel().catch(() => {});
	}

	private throwIfClosing(): void {
		if (this.closingProvider) {
			throw new Error('[vitest] The Browser Run provider was closed.');
		}
	}
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

		await delay(250);
	}

	return getBrowserRunPublicOrigin(options);
}

function getBrowserRunPublicOrigin(options: BrowserRunCdpOptions): string {
	return options.publicOrigin ?? process.env[browserRunPublicOriginEnv] ?? process.env[cloudflareTunnelUrlEnv] ?? '';
}

function createBasePlaywrightOptions(options: ResolvedBrowserRunCdpOptions): PlaywrightProviderOptions {
	return {
		connectOverCDPOptions: createBrowserRunCdpConnection(options),
		contextStrategy: 'reuse-default-on-failure' satisfies PlaywrightContextStrategy,
	};
}

export function createBrowserRunCdpConnection(options: ResolvedBrowserRunCdpOptions): BrowserRunCdpConnectOptions {
	return {
		wsEndpoint: getBrowserRunWsEndpoint(options),
		headers: { Authorization: `Bearer ${getBrowserRunApiToken(options)}` },
	};
}

export function resolveBrowserRunCdpOptions(options: BrowserRunCdpOptions): ResolvedBrowserRunCdpOptions {
	const resolved = {
		accountId: options.accountId ?? process.env[cloudflareAccountIdEnv] ?? '',
		apiToken: options.apiToken ?? process.env[cloudflareApiTokenEnv] ?? '',
		wsEndpoint: options.wsEndpoint ?? process.env[cloudflareBrowserRunWsEndpointEnv] ?? '',
		publicOrigin: options.publicOrigin ?? process.env[browserRunPublicOriginEnv] ?? process.env[cloudflareTunnelUrlEnv] ?? '',
		keepAliveMs: options.keepAliveMs ?? readNumber(process.env[cloudflareBrowserRunKeepAliveMsEnv], 600000, cloudflareBrowserRunKeepAliveMsEnv),
		recording: options.recording ?? readBoolean(process.env[cloudflareBrowserRunRecordingEnv], false, cloudflareBrowserRunRecordingEnv),
		pool: resolveBrowserRunPoolOptions(options.pool ?? {}),
	} satisfies ResolvedBrowserRunCdpOptions;

	validateBrowserRunCdpOptions(resolved);
	return resolved;
}

export function resolveBrowserRunPoolOptions(options: BrowserRunPoolOptions): ResolvedBrowserRunPoolOptions {
	const resolved = {
		maxBrowsers: options.maxBrowsers ?? readNumber(process.env[cloudflareBrowserRunMaxBrowsersEnv], 1, cloudflareBrowserRunMaxBrowsersEnv),
		sessionsPerBrowser: options.sessionsPerBrowser ?? readNumber(process.env[cloudflareBrowserRunSessionsPerBrowserEnv], unlimitedSessionsPerBrowser, cloudflareBrowserRunSessionsPerBrowserEnv),
		acquireIntervalMs: options.acquireIntervalMs ?? readNumber(process.env[cloudflareBrowserRunAcquireIntervalMsEnv], 1000, cloudflareBrowserRunAcquireIntervalMsEnv),
		acquireTimeoutMs: options.acquireTimeoutMs ?? readNumber(process.env[cloudflareBrowserRunAcquireTimeoutMsEnv], 180000, cloudflareBrowserRunAcquireTimeoutMsEnv),
		retry429: options.retry429 ?? readBoolean(process.env[cloudflareBrowserRunRetry429Env], true, cloudflareBrowserRunRetry429Env),
	} satisfies ResolvedBrowserRunPoolOptions;

	validateBrowserRunPoolOptions(resolved);
	return resolved;
}

export function validateBrowserRunPoolOptions(options: ResolvedBrowserRunPoolOptions): void {
	assertIntegerAtLeast(options.maxBrowsers, 1, 'pool.maxBrowsers');
	assertIntegerAtLeast(options.sessionsPerBrowser, 0, 'pool.sessionsPerBrowser');
	assertIntegerAtLeast(options.acquireIntervalMs, 0, 'pool.acquireIntervalMs');
	assertIntegerAtLeast(options.acquireTimeoutMs, 1, 'pool.acquireTimeoutMs');
}

function validateBrowserRunCdpOptions(options: ResolvedBrowserRunCdpOptions): void {
	if (options.wsEndpoint && options.pool.maxBrowsers > 1) {
		throw new Error(
			`${cloudflareBrowserRunWsEndpointEnv} cannot be used with Browser Run pooling above one browser. `
			+ `Unset ${cloudflareBrowserRunWsEndpointEnv} or set ${cloudflareBrowserRunMaxBrowsersEnv}=1.`,
		);
	}
}

function assertIntegerAtLeast(value: number, min: number, name: string): void {
	if (!Number.isInteger(value) || value < min) {
		throw new Error(`Invalid ${name}: expected an integer greater than or equal to ${min}, got ${JSON.stringify(value)}.`);
	}
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

	const accountId = getBrowserRunAccountId(options);
	const endpoint = new URL(`wss://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/devtools/browser`);
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

function getBrowserRunAccountId(options: Pick<ResolvedBrowserRunCdpOptions, 'accountId'>): string {
	if (!options.accountId) {
		throw new Error(
			`Missing ${cloudflareAccountIdEnv}. Set ${cloudflareAccountIdEnv} in .env or your shell before running Browser Run tests. `
			+ `You can also pass accountId to browserRunCdp() or set ${cloudflareBrowserRunWsEndpointEnv} to bypass account-scoped URL construction.`,
		);
	}

	return options.accountId;
}

function getBrowserRunSessionApiUrl(accountId: string, options: Pick<ResolvedBrowserRunCdpOptions, 'keepAliveMs' | 'recording'>): string {
	const endpoint = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/devtools/browser`);
	endpoint.searchParams.set('keep_alive', String(options.keepAliveMs));
	if (options.recording) {
		endpoint.searchParams.set('recording', 'true');
	}
	return endpoint.href;
}

function getBrowserRunSessionWsEndpoint(options: Pick<ResolvedBrowserRunCdpOptions, 'accountId'>, sessionId: string): string {
	return `wss://api.cloudflare.com/client/v4/accounts/${options.accountId}/browser-rendering/devtools/browser/${sessionId}`;
}

function getBrowserRunSessionDeleteUrl(accountId: string, sessionId: string): string {
	return `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/devtools/browser/${sessionId}`;
}

function normalizeBrowserRunSessionResponse(payload: unknown): BrowserRunSessionResponse {
	if (payload && typeof payload === 'object' && 'result' in payload) {
		const result = (payload as { result?: unknown }).result;
		return result && typeof result === 'object' ? result as BrowserRunSessionResponse : {};
	}

	return payload && typeof payload === 'object' ? payload as BrowserRunSessionResponse : {};
}

function readRetryAfterMs(value: string | null): number | undefined {
	if (!value) {
		return undefined;
	}

	const seconds = Number(value);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}

	const date = Date.parse(value);
	if (Number.isFinite(date)) {
		return Math.max(0, date - Date.now());
	}

	return undefined;
}

async function delay(ms: number): Promise<void> {
	if (ms <= 0) {
		return;
	}

	await new Promise((resolve) => setTimeout(resolve, ms));
}
