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
const cloudflareBrowserRunPrewarmEnv = 'CLOUDFLARE_BROWSER_RUN_PREWARM';

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
	/** Pre-acquire Browser Run browsers lazily on first use. Use true for the required pool size or a number for an exact count. */
	prewarm?: boolean | number;
}

export interface ResolvedBrowserRunPoolOptions {
	maxBrowsers: number;
	sessionsPerBrowser: number;
	acquireIntervalMs: number;
	acquireTimeoutMs: number;
	retry429: boolean;
	prewarm: boolean | number;
}

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
	timing: BrowserRunLeaseTiming;
}

interface PendingBrowserRunLease {
	id: number;
	activeSessionIds: Set<string>;
	promise: Promise<BrowserRunLease>;
	timing: BrowserRunLeaseTiming;
}

interface BrowserRunLeaseTiming {
	pendingStartedAt: number;
	acquireStartedAt?: number;
	acquireEndedAt?: number;
	sessionAttempts?: BrowserRunSessionAttemptTiming[];
	sessionCreatedAt?: number;
	cdpConnectStartedAt?: number;
	cdpConnectEndedAt?: number;
	leaseReadyAt?: number;
	errorAt?: number;
}

interface BrowserRunSessionAttemptTiming {
	queueStartedAt: number;
	queueEnteredAt?: number;
	acquireSlotWaitStartedAt?: number;
	acquireSlotWaitEndedAt?: number;
	sessionPostStartedAt?: number;
	sessionPostEndedAt?: number;
	rateLimitedAt?: number;
	retryAfterMs?: number;
	errorAt?: number;
}

interface BrowserRunOpenPageTiming {
	openPageStartedAt: number;
	reserveStartedAt?: number;
	reserveEndedAt?: number;
	contextStartedAt?: number;
	contextEndedAt?: number;
	pageStartedAt?: number;
	pageEndedAt?: number;
	initScriptStartedAt?: number;
	initScriptEndedAt?: number;
	waitRunnerStartedAt?: number;
	waitLocalInitialStartedAt?: number;
	waitLocalInitialEndedAt?: number;
	waitPublicOriginStartedAt?: number;
	waitPublicOriginEndedAt?: number;
	waitLocalFinalStartedAt?: number;
	waitLocalFinalEndedAt?: number;
	waitRunnerEndedAt?: number;
	gotoStartedAt?: number;
	gotoEndedAt?: number;
	metadataUpdatedAt?: number;
	openPageEndedAt?: number;
	errorAt?: number;
}

interface BrowserRunProviderTiming {
	providerOptionCreatedAt: number;
	providerFactoryStartedAt?: number;
	providerFactoryEndedAt?: number;
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
	const providerTiming: BrowserRunProviderTiming = { providerOptionCreatedAt: Date.now() };
	const resolvedOptions = resolveBrowserRunCdpOptions(options);
	const base = vitestPlaywright();

	return {
		...base,
		name: 'playwright',
		supportedBrowser: ['chromium'],
		options: resolvedOptions,
		providerFactory(project) {
			providerTiming.providerFactoryStartedAt = Date.now();
			const provider = new BrowserRunCdpProvider(project, options, resolvedOptions, providerTiming);
			providerTiming.providerFactoryEndedAt = Date.now();
			return provider;
		},
	};
}

export class BrowserRunCdpProvider extends PlaywrightBrowserProvider {
	private readonly sourceOptions: BrowserRunCdpOptions;
	private readonly browserRunOptions: ResolvedBrowserRunCdpOptions;
	private readonly providerTiming: BrowserRunProviderTiming;
	private readonly leases: BrowserRunLease[] = [];
	private readonly pendingLeases: PendingBrowserRunLease[] = [];
	private readonly sessionLeases = new Map<string, BrowserRunLease>();
	private readonly sessionPendingLeases = new Map<string, PendingBrowserRunLease>();
	private readonly sessionMetadata = new Map<string, Record<string, unknown>>();
	private acquireSessionQueue: Promise<void> = Promise.resolve();
	private lastAcquireAt = 0;
	private nextLeaseId = 1;
	private closingProvider = false;
	private capacityValidated = false;
	private prewarmStarted = false;

	constructor(project: TestProject, sourceOptions: BrowserRunCdpOptions, resolvedOptions: ResolvedBrowserRunCdpOptions, providerTiming: BrowserRunProviderTiming) {
		super(project, createBasePlaywrightOptions(resolvedOptions));
		this.sourceOptions = sourceOptions;
		this.browserRunOptions = resolvedOptions;
		this.providerTiming = providerTiming;
	}

	async openPage(sessionId: string, url: string, options: { parallel: boolean }): Promise<void> {
		const timing: BrowserRunOpenPageTiming = { openPageStartedAt: Date.now() };
		this.validateProjectCapacity();
		this.throwIfClosing();
		this.startPrewarmIfNeeded();

		if (this.pages.has(sessionId)) {
			await this.closeSessionResources(sessionId);
		}

		timing.reserveStartedAt = Date.now();
		const lease = await this.reserveLease(sessionId);
		timing.reserveEndedAt = Date.now();
		let context: BrowserContext | undefined;
		let page: Page | undefined;

		try {
			timing.contextStartedAt = Date.now();
			context = await this.createBrowserRunContext(lease);
			timing.contextEndedAt = Date.now();
			timing.pageStartedAt = Date.now();
			page = await context.newPage();
			timing.pageEndedAt = Date.now();
			timing.initScriptStartedAt = Date.now();
			await page.addInitScript({ content: this.createPoolMetadataScript(sessionId, lease, timing) });
			timing.initScriptEndedAt = Date.now();

			this.contexts.set(sessionId, context as never);
			this.pages.set(sessionId, page as never);

			await waitForBrowserRunRunnerReady(url, this.sourceOptions, timing);
			this.throwIfClosing();

			const resolvedUrl = resolveBrowserRunRunnerUrl(url, getBrowserRunPublicOrigin(this.sourceOptions));
			timing.gotoStartedAt = Date.now();
			await page.goto(resolvedUrl, { timeout: 0 });
			timing.gotoEndedAt = Date.now();
			timing.openPageEndedAt = Date.now();
			await this.updatePoolMetadata(page, sessionId, lease, timing);
		}
		catch (error) {
			timing.errorAt = Date.now();
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

		const pendingLeases = [...this.pendingLeases];
		await Promise.all([
			...this.leases.map((lease) => this.closeLease(lease)),
			...pendingLeases.map(async (pending) => {
				const lease = await pending.promise.catch(() => undefined);
				if (lease) {
					await this.closeLease(lease);
				}
			}),
		]);

		this.leases.length = 0;
		this.pendingLeases.length = 0;
		this.sessionLeases.clear();
		this.sessionPendingLeases.clear();
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
		this.throwIfClosing();

		const existing = this.sessionLeases.get(sessionId);
		if (existing) {
			return existing;
		}

		const existingPending = this.sessionPendingLeases.get(sessionId);
		if (existingPending) {
			return existingPending.promise;
		}

		while (true) {
			const lease = this.findLeaseWithCapacity();
			if (lease) {
				return this.assignReadyLease(sessionId, lease);
			}

			const pendingLease = this.findPendingLeaseWithCapacity();
			if (pendingLease) {
				this.assignPendingLease(sessionId, pendingLease);
				return pendingLease.promise;
			}

			if (this.getLeaseCount() >= this.browserRunOptions.pool.maxBrowsers) {
				const capacity = this.getCapacityDescription();
				throw new Error(`Browser Run pool is exhausted (${capacity}). Lower maxWorkers or increase Browser Run pool limits.`);
			}

			this.ensureLeaseCount(this.getLeaseCount() + 1);
		}
	}

	private findLeaseWithCapacity(): BrowserRunLease | undefined {
		const sessionsPerBrowser = this.getSessionsPerBrowser();
		return this.leases.find((lease) => !lease.closed && lease.activeSessionIds.size < sessionsPerBrowser);
	}

	private findPendingLeaseWithCapacity(): PendingBrowserRunLease | undefined {
		const sessionsPerBrowser = this.getSessionsPerBrowser();
		return this.pendingLeases.find((lease) => lease.activeSessionIds.size < sessionsPerBrowser);
	}

	private assignReadyLease(sessionId: string, lease: BrowserRunLease): BrowserRunLease {
		lease.activeSessionIds.add(sessionId);
		this.sessionLeases.set(sessionId, lease);
		return lease;
	}

	private assignPendingLease(sessionId: string, lease: PendingBrowserRunLease): void {
		lease.activeSessionIds.add(sessionId);
		this.sessionPendingLeases.set(sessionId, lease);
	}

	private ensureLeaseCount(target: number): PendingBrowserRunLease[] {
		const cappedTarget = Math.min(this.browserRunOptions.pool.maxBrowsers, Math.max(0, target));
		const started: PendingBrowserRunLease[] = [];
		while (this.getLeaseCount() < cappedTarget) {
			started.push(this.startPendingLease());
		}

		return started;
	}

	private getLeaseCount(): number {
		return this.leases.filter((lease) => !lease.closed).length + this.pendingLeases.length;
	}

	private startPendingLease(): PendingBrowserRunLease {
		this.throwIfClosing();
		const timing: BrowserRunLeaseTiming = { pendingStartedAt: Date.now() };

		const pending: PendingBrowserRunLease = {
			id: this.nextLeaseId,
			activeSessionIds: new Set(),
			promise: undefined as unknown as Promise<BrowserRunLease>,
			timing,
		};
		this.nextLeaseId += 1;

		pending.promise = this.acquireBrowser(timing)
			.then(async (acquired) => {
				timing.leaseReadyAt = Date.now();
				const lease: BrowserRunLease = {
					id: pending.id,
					browser: acquired.browser,
					browserRunSessionId: acquired.browserRunSessionId,
					activeSessionIds: pending.activeSessionIds,
					closed: false,
					timing,
				};

				this.removePendingLease(pending);
				if (this.closingProvider) {
					await this.closeLease(lease);
					throw new Error('[vitest] The Browser Run provider was closed.');
				}

				this.leases.push(lease);
				for (const activeSessionId of lease.activeSessionIds) {
					this.sessionPendingLeases.delete(activeSessionId);
					this.sessionLeases.set(activeSessionId, lease);
				}

				return lease;
			})
			.catch((error) => {
				timing.errorAt = Date.now();
				this.removePendingLease(pending);
				for (const activeSessionId of pending.activeSessionIds) {
					if (this.sessionPendingLeases.get(activeSessionId) === pending) {
						this.sessionPendingLeases.delete(activeSessionId);
					}
					this.sessionMetadata.delete(activeSessionId);
				}

				throw error;
			});

		this.pendingLeases.push(pending);
		pending.promise.catch(() => {});
		return pending;
	}

	private removePendingLease(lease: PendingBrowserRunLease): void {
		const index = this.pendingLeases.indexOf(lease);
		if (index >= 0) {
			this.pendingLeases.splice(index, 1);
		}
	}

	private startPrewarmIfNeeded(): void {
		if (this.prewarmStarted) {
			return;
		}

		this.prewarmStarted = true;
		const target = this.getPrewarmTarget();
		if (target <= 0) {
			return;
		}

		this.ensureLeaseCount(target);
	}

	private getPrewarmTarget(): number {
		const prewarm = this.browserRunOptions.pool.prewarm;
		if (prewarm === false || prewarm === 0) {
			return 0;
		}

		const maxBrowsers = this.browserRunOptions.wsEndpoint ? 1 : this.browserRunOptions.pool.maxBrowsers;
		if (typeof prewarm === 'number') {
			return Math.min(maxBrowsers, prewarm);
		}

		const sessionsPerBrowser = this.getSessionsPerBrowser();
		const maxNeeded = Number.isFinite(sessionsPerBrowser)
			? Math.ceil(this.getProjectMaxWorkers() / sessionsPerBrowser)
			: 1;
		return Math.min(maxBrowsers, Math.max(1, maxNeeded));
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

	private async acquireBrowser(timing: BrowserRunLeaseTiming): Promise<BrowserRunAcquireResult> {
		timing.acquireStartedAt = Date.now();
		if (this.browserRunOptions.wsEndpoint) {
			if (this.browserRunOptions.pool.maxBrowsers > 1) {
				throw new Error(
					`${cloudflareBrowserRunWsEndpointEnv} cannot be used with Browser Run pooling above one browser. `
					+ `Unset ${cloudflareBrowserRunWsEndpointEnv} and use ${cloudflareAccountIdEnv} so the provider can acquire multiple Browser Run sessions.`,
				);
			}

			this.throwIfClosing();
			timing.cdpConnectStartedAt = Date.now();
			const browser = await this.connectOverCdp(this.browserRunOptions.wsEndpoint);
			timing.cdpConnectEndedAt = Date.now();
			timing.acquireEndedAt = Date.now();
			return {
				browser,
				browserRunSessionId: '',
			};
		}

		const session = await this.acquireBrowserRunSession(timing);
		return this.connectBrowserRunSession(session, timing);
	}

	private async connectBrowserRunSession(session: BrowserRunSessionResponse, timing: BrowserRunLeaseTiming): Promise<BrowserRunAcquireResult> {
		const wsEndpoint = session.webSocketDebuggerUrl ?? getBrowserRunSessionWsEndpoint(this.browserRunOptions, session.sessionId!);
		const browserRunSessionId = session.sessionId ?? '';
		try {
			this.throwIfClosing();
			timing.cdpConnectStartedAt = Date.now();
			const browser = await this.connectOverCdp(wsEndpoint);
			timing.cdpConnectEndedAt = Date.now();
			timing.acquireEndedAt = Date.now();
			return {
				browser,
				browserRunSessionId,
			};
		}
		catch (error) {
			timing.errorAt = Date.now();
			await this.closeBrowserRunSession(browserRunSessionId).catch(() => {});
			throw error;
		}
	}

	private async acquireBrowserRunSession(timing: BrowserRunLeaseTiming): Promise<BrowserRunSessionResponse> {
		const startedAt = Date.now();
		let lastError: unknown;

		while (Date.now() - startedAt <= this.browserRunOptions.pool.acquireTimeoutMs) {
			const attempt: BrowserRunSessionAttemptTiming = { queueStartedAt: Date.now() };
			(timing.sessionAttempts ??= []).push(attempt);
			try {
				return await this.enqueueBrowserRunSessionStart(async () => {
					attempt.queueEnteredAt = Date.now();
					this.throwIfClosing();
					attempt.acquireSlotWaitStartedAt = Date.now();
					await this.waitForAcquireSlot();
					attempt.acquireSlotWaitEndedAt = Date.now();
					this.throwIfClosing();
					const session = await this.acquireBrowserRunSessionOnly(attempt);
					this.lastAcquireAt = Date.now();
					timing.sessionCreatedAt = this.lastAcquireAt;
					return session;
				});
			}
			catch (error) {
				if (!(error instanceof BrowserRunRateLimitError)) {
					attempt.errorAt = Date.now();
					throw error;
				}

				lastError = error;
				attempt.rateLimitedAt = Date.now();
				attempt.retryAfterMs = error.retryAfterMs ?? this.browserRunOptions.pool.acquireIntervalMs;
				await delay(error.retryAfterMs ?? this.browserRunOptions.pool.acquireIntervalMs);
				continue;
			}
		}

		throw new Error(`Timed out acquiring a Browser Run session after ${this.browserRunOptions.pool.acquireTimeoutMs}ms.`, { cause: lastError });
	}

	private async acquireBrowserRunSessionOnly(timing: BrowserRunSessionAttemptTiming): Promise<BrowserRunSessionResponse> {
		const accountId = getBrowserRunAccountId(this.browserRunOptions);
		const apiToken = getBrowserRunApiToken(this.browserRunOptions);
		timing.sessionPostStartedAt = Date.now();
		const response = await fetch(getBrowserRunSessionApiUrl(accountId, this.browserRunOptions), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
			},
		});
		timing.sessionPostEndedAt = Date.now();

		if (response.status === 429 && this.browserRunOptions.pool.retry429) {
			await response.body?.cancel().catch(() => {});
			throw new BrowserRunRateLimitError(readRetryAfterMs(response.headers.get('Retry-After')));
		}

		if (!response.ok) {
			timing.errorAt = Date.now();
			const message = await response.text().catch(() => response.statusText);
			throw new Error(`Browser Run session acquisition failed with HTTP ${response.status}: ${message}`);
		}

		const result = normalizeBrowserRunSessionResponse(await response.json());
		if (!result.sessionId && !result.webSocketDebuggerUrl) {
			throw new Error('Browser Run session acquisition succeeded but did not return sessionId or webSocketDebuggerUrl.');
		}

		return result;
	}

	private enqueueBrowserRunSessionStart<T>(operation: () => Promise<T>): Promise<T> {
		const queued = this.acquireSessionQueue.then(operation, operation);
		this.acquireSessionQueue = queued.then(() => undefined, () => undefined);
		return queued;
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

	private createPoolMetadataScript(sessionId: string, lease: BrowserRunLease, timing: BrowserRunOpenPageTiming): string {
		const metadata = this.setPoolMetadata(sessionId, lease, timing);
		return createPoolMetadataAssignmentScript(metadata);
	}

	private async updatePoolMetadata(page: Page, sessionId: string, lease: BrowserRunLease, timing: BrowserRunOpenPageTiming): Promise<void> {
		timing.metadataUpdatedAt = Date.now();
		const metadata = this.setPoolMetadata(sessionId, lease, timing);
		await page.addInitScript({ content: createPoolMetadataAssignmentScript(metadata) });
		await page.evaluate(setBrowserRunPoolMetadata, metadata);

		if (typeof page.frames === 'function') {
			await Promise.all(page.frames().map(async (frame: { evaluate: (callback: typeof setBrowserRunPoolMetadata, value: Record<string, unknown>) => Promise<unknown> }) => {
				await frame.evaluate(setBrowserRunPoolMetadata, metadata).catch(() => {});
			}));
		}
	}

	private setPoolMetadata(sessionId: string, lease: BrowserRunLease, timing: BrowserRunOpenPageTiming): Record<string, unknown> {
		const sessionsPerBrowser = this.getSessionsPerBrowser();
		const metadata = {
			browserLeaseId: lease.id,
			browserLeaseIndex: this.leases.indexOf(lease),
			browserRunSessionId: lease.browserRunSessionId,
			browserRunTimings: {
				lease: { ...lease.timing },
				openPage: { ...timing },
				provider: { ...this.providerTiming },
			},
			maxBrowsers: this.browserRunOptions.pool.maxBrowsers,
			sessionId,
			sessionsPerBrowser: Number.isFinite(sessionsPerBrowser) ? sessionsPerBrowser : null,
		};
		this.sessionMetadata.set(sessionId, metadata);
		return metadata;
	}

	private async closeLease(lease: BrowserRunLease): Promise<void> {
		if (lease.closed) {
			return;
		}

		lease.closed = true;
		await lease.browser.close().catch(() => {});
		await this.closeBrowserRunSession(lease.browserRunSessionId).catch(() => {});
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

function createPoolMetadataAssignmentScript(metadata: Record<string, unknown>): string {
	return `Object.defineProperty(globalThis, '__CLOUDFLARE_BROWSER_RUN_POOL__', { configurable: true, value: ${JSON.stringify(metadata)} });${browserRunStartupMarksScript}`;
}

const browserRunStartupMarksScript = `
(() => {
	const key = '__CLOUDFLARE_BROWSER_RUN_STARTUP_MARKS__';
	if (globalThis[key]?.installed) {
		return;
	}
	const marks = {
		domContentLoadedAt: document.readyState === 'loading' ? null : Date.now(),
		iframeReadyMessages: [],
		initScriptAt: Date.now(),
		installed: true,
		loadAt: document.readyState === 'complete' ? Date.now() : null,
	};
	Object.defineProperty(globalThis, key, { configurable: true, value: marks });
	globalThis.addEventListener('DOMContentLoaded', () => {
		marks.domContentLoadedAt ??= Date.now();
	}, { once: true });
	globalThis.addEventListener('load', () => {
		marks.loadAt ??= Date.now();
	}, { once: true });
	globalThis.addEventListener('message', (event) => {
		if (event.data?.event === 'ready') {
			marks.iframeReadyMessages.push({
				at: Date.now(),
				iframeId: event.data.iframeId,
				source: 'window-message',
			});
		}
	});
	const sessionId = globalThis.__CLOUDFLARE_BROWSER_RUN_POOL__?.sessionId;
	if (sessionId && typeof BroadcastChannel === 'function') {
		try {
			const channel = new BroadcastChannel('vitest:' + sessionId);
			Object.defineProperty(globalThis, '__CLOUDFLARE_BROWSER_RUN_STARTUP_CHANNEL__', { configurable: true, value: channel });
			channel.addEventListener('message', (event) => {
				if (event.data?.event === 'ready') {
					marks.iframeReadyMessages.push({
						at: Date.now(),
						iframeId: event.data.iframeId,
						source: 'broadcast-channel',
					});
				}
			});
		}
		catch {}
	}
})();`;

function setBrowserRunPoolMetadata(value: Record<string, unknown>): void {
	Object.defineProperty(globalThis, '__CLOUDFLARE_BROWSER_RUN_POOL__', { configurable: true, value });
}

async function waitForBrowserRunRunnerReady(url: string, options: BrowserRunCdpOptions, timing: BrowserRunOpenPageTiming): Promise<void> {
	timing.waitRunnerStartedAt = Date.now();
	timing.waitLocalInitialStartedAt = Date.now();
	await waitForLocalBrowserRunner(url);
	timing.waitLocalInitialEndedAt = Date.now();
	timing.waitPublicOriginStartedAt = Date.now();
	await waitForBrowserRunPublicOrigin(options);
	timing.waitPublicOriginEndedAt = Date.now();
	timing.waitLocalFinalStartedAt = Date.now();
	await waitForLocalBrowserRunner(url, { attempts: 120, intervalMs: 500 });
	timing.waitLocalFinalEndedAt = Date.now();
	timing.waitRunnerEndedAt = Date.now();
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
		prewarm: options.prewarm ?? readPrewarmOption(process.env[cloudflareBrowserRunPrewarmEnv], false, cloudflareBrowserRunPrewarmEnv),
	} satisfies ResolvedBrowserRunPoolOptions;

	validateBrowserRunPoolOptions(resolved);
	return resolved;
}

export function validateBrowserRunPoolOptions(options: ResolvedBrowserRunPoolOptions): void {
	assertIntegerAtLeast(options.maxBrowsers, 1, 'pool.maxBrowsers');
	assertIntegerAtLeast(options.sessionsPerBrowser, 0, 'pool.sessionsPerBrowser');
	assertIntegerAtLeast(options.acquireIntervalMs, 0, 'pool.acquireIntervalMs');
	assertIntegerAtLeast(options.acquireTimeoutMs, 1, 'pool.acquireTimeoutMs');
	if (typeof options.prewarm !== 'boolean' && typeof options.prewarm !== 'number') {
		throw new Error(`Invalid pool.prewarm: expected a boolean or an integer greater than or equal to 0, got ${JSON.stringify(options.prewarm)}.`);
	}
	if (typeof options.prewarm === 'number') {
		assertIntegerAtLeast(options.prewarm, 0, 'pool.prewarm');
	}
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

function readPrewarmOption(value: string | undefined, defaultValue: boolean | number, name: string): boolean | number {
	if (value == null || value === '') {
		return defaultValue;
	}

	const normalized = value.toLowerCase();
	if (normalized === 'true') {
		return true;
	}

	if (normalized === 'false' || normalized === '0') {
		return false;
	}

	const number = Number(value);
	if (Number.isInteger(number) && number > 0) {
		return number;
	}

	throw new Error(`Invalid ${name}: expected true, false, 0, or a positive integer, got ${JSON.stringify(value)}.`);
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

class BrowserRunRateLimitError extends Error {
	constructor(readonly retryAfterMs: number | undefined) {
		super('Browser Run acquisition was rate limited.');
	}
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
