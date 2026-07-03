import { defineBrowserProvider } from '@vitest/browser';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Frame, type FrameLocator, type Page } from 'playwright-core';
import type { BrowserCommand, BrowserProvider, BrowserProviderOption, CDPSession, TestProject } from 'vitest/node';

import { registerBrowserCdpCommands } from './commands.js';
import {
	type BrowserRunnerPublicOrigin,
	isTransientBrowserRunnerNavigationError,
	resolveBrowserRunnerPublicOrigin,
	resolveBrowserRunnerUrl,
	waitForLocalBrowserRunner,
} from './runner-origin.js';

export interface BrowserCdpConnection {
	wsEndpoint: string;
	headers?: Record<string, string>;
}

export interface BrowserCdpConnectContext {
	sessionId: string;
	parallel: boolean;
}

export interface BrowserCdpRetryOptions {
	attempts?: number;
	shouldRetry?: (error: unknown, attempt: number) => boolean;
	delayMs?: (attempt: number, error: unknown) => number;
}

export interface BrowserCdpOptions {
	name?: string;
	connect: (context: BrowserCdpConnectContext) => BrowserCdpConnection | Promise<BrowserCdpConnection>;
	publicOrigin?: BrowserRunnerPublicOrigin;
	requirePublicOrigin?: boolean;
	browserPerSession?: boolean;
	launchDelayMs?: number;
	logSessions?: boolean;
	contextOptions?: BrowserContextOptions;
	commands?: Record<string, BrowserCommand>;
	connectRetry?: BrowserCdpRetryOptions;
	navigationRetry?: BrowserCdpRetryOptions;
}

export interface ChromiumCdpOptions extends BrowserCdpOptions {}

export type ChromiumCdpConnection = BrowserCdpConnection;
export type ChromiumCdpConnectContext = BrowserCdpConnectContext;

const defaultNavigationRetry: Required<BrowserCdpRetryOptions> = {
	attempts: 8,
	shouldRetry: isTransientBrowserRunnerNavigationError,
	delayMs: (attempt) => Math.min(attempt * 1000, 5000),
};

export function browserCdp(options: BrowserCdpOptions): BrowserProviderOption {
	return defineBrowserProvider({
		name: options.name ?? 'browser-cdp',
		supportedBrowser: ['chromium'],
		options: {},
		providerFactory(project) {
			return new BrowserCdpProvider(project, options);
		},
	});
}

export function chromiumCdp(options: ChromiumCdpOptions): BrowserProviderOption {
	return browserCdp({
		...options,
		name: options.name ?? 'chromium-cdp',
	});
}

export class BrowserCdpProvider implements BrowserProvider {
	name: string;
	supportsParallelism = true;

	private browsers = new Map<string, Browser>();
	private browserPromises = new Map<string, Promise<Browser>>();
	private contexts = new Map<string, BrowserContext>();
	private pages = new Map<string, Page>();
	private launchQueue: Promise<void> = Promise.resolve();
	private nextLaunchAt = 0;

	constructor(
		private project: TestProject,
		private options: BrowserCdpOptions,
	) {
		this.name = options.name ?? 'browser-cdp';
		registerBrowserCdpCommands(project, options.commands);
	}

	getCommandsContext(sessionId: string): {
		page: Page;
		context: BrowserContext;
		frame: () => Promise<Frame>;
		readonly iframe: FrameLocator;
	} {
		const page = this.getPage(sessionId);
		return {
			page,
			context: this.contexts.get(sessionId)!,
			frame(): Promise<Frame> {
				return new Promise<Frame>((resolve, reject) => {
					const frame = page.frame('vitest-iframe');
					if (frame) {
						resolve(frame);
						return;
					}

					const timeout = setTimeout(() => {
						reject(new Error('Cannot find "vitest-iframe" on the page.'));
					}, 1000);
					timeout.unref?.();

					page.on('frameattached', (frame) => {
						clearTimeout(timeout);
						resolve(frame);
					});
				});
			},
			get iframe(): FrameLocator {
				return page.frameLocator('[data-vitest="true"]');
			},
		};
	}

	async openPage(sessionId: string, url: string, options: { parallel: boolean } = { parallel: false }): Promise<void> {
		const publicOrigin = resolveBrowserRunnerPublicOrigin(this.options.publicOrigin);
		const browserUrl = resolveBrowserRunnerUrl(url, publicOrigin, this.options.requirePublicOrigin);
		this.log(`opening browser runner ${url} via ${browserUrl}`);

		if (publicOrigin) {
			await waitForLocalBrowserRunner(url);
		}

		const browser = await this.openBrowser(this.getBrowserKey(sessionId, options.parallel), {
			sessionId,
			parallel: options.parallel,
		});
		const context = await this.getContext(sessionId, browser);
		const previousPage = this.pages.get(sessionId);

		if (previousPage && !previousPage.isClosed()) {
			await previousPage.close();
		}

		const page = await context.newPage();
		this.pages.set(sessionId, page);
		await this.gotoBrowserRunner(page, browserUrl);
	}

	async getCDPSession(sessionId: string): Promise<CDPSession> {
		const page = this.pages.get(sessionId);
		if (!page) {
			throw new Error(`Chromium CDP page for session ${sessionId} was not opened.`);
		}

		const session = await page.context().newCDPSession(page);
		return {
			send: session.send.bind(session),
			on: session.on.bind(session),
			off: session.off.bind(session),
			once: session.once.bind(session),
		} as CDPSession;
	}

	async close(): Promise<void> {
		await Promise.all([...this.pages.values()].filter((page) => !page.isClosed()).map((page) => page.close()));
		this.pages.clear();
		await Promise.all([...this.contexts.values()].map((context) => context.close().catch(() => undefined)));
		this.contexts.clear();

		await Promise.all([...this.browsers.values()].filter((browser) => browser.isConnected()).map((browser) => browser.close()));
		this.browsers.clear();
		this.browserPromises.clear();
	}

	private async gotoBrowserRunner(page: Page, url: string): Promise<void> {
		const retry = this.options.navigationRetry ?? defaultNavigationRetry;
		const attempts = getRetryAttempts(retry, 'navigationRetry');
		let lastError: unknown;

		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				await page.goto(url, { timeout: 0, waitUntil: 'commit' });
				return;
			} catch (error) {
				lastError = error;
				const transient = retry.shouldRetry?.(error, attempt) ?? false;
				if (transient && await this.hasBrowserRunnerFrame(page)) {
					return;
				}

				if (attempt === attempts || !transient) {
					throw error;
				}

				const waitMs = retry.delayMs?.(attempt, error) ?? 0;
				this.log(`browser runner navigation failed; retrying in ${waitMs}ms`);
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}
		}

		throw lastError;
	}

	private async hasBrowserRunnerFrame(page: Page): Promise<boolean> {
		if (page.frame('vitest-iframe')) {
			return true;
		}

		try {
			await page.waitForSelector('[data-vitest="true"]', { timeout: 250 });
			return true;
		} catch {
			return false;
		}
	}

	private getPage(sessionId: string): Page {
		const page = this.pages.get(sessionId);
		if (!page) {
			throw new Error(`Chromium CDP page for session ${sessionId} was not opened.`);
		}
		return page;
	}

	private async openBrowser(browserKey: string, context: BrowserCdpConnectContext): Promise<Browser> {
		const existingBrowser = this.browsers.get(browserKey);
		if (existingBrowser?.isConnected()) {
			return existingBrowser;
		}

		const existingPromise = this.browserPromises.get(browserKey);
		if (existingPromise) {
			return existingPromise;
		}

		const browserPromise = this.connectBrowser(browserKey, context);
		this.browserPromises.set(browserKey, browserPromise);

		return browserPromise;
	}

	private async connectBrowser(browserKey: string, context: BrowserCdpConnectContext): Promise<Browser> {
		try {
			const retry = this.options.connectRetry;
			const attempts = getRetryAttempts(retry, 'connectRetry');

			for (let attempt = 1; attempt <= attempts; attempt += 1) {
				await this.waitForLaunchSlot();
				this.log(`connecting CDP browser ${browserKey}${attempt > 1 ? ` (attempt ${attempt}/${attempts})` : ''}`);

				try {
					const connection = await this.options.connect(context);
					const browser = await chromium.connectOverCDP(connection.wsEndpoint, {
						headers: connection.headers,
					});
					this.browsers.set(browserKey, browser);
					this.log(`connected CDP browser ${browserKey}; active browsers: ${this.browsers.size}`);
					return browser;
				} catch (error) {
					const transient = retry?.shouldRetry?.(error, attempt) ?? false;
					if (attempt === attempts || !transient) {
						throw error;
					}

					const waitMs = retry?.delayMs?.(attempt, error) ?? 0;
					this.log(`CDP browser ${browserKey} failed to connect; retrying in ${waitMs}ms`);
					await new Promise((resolve) => setTimeout(resolve, waitMs));
				}
			}

			throw new Error(`Could not connect CDP browser ${browserKey}.`);
		} finally {
			this.browserPromises.delete(browserKey);
		}
	}

	private async getContext(sessionId: string, browser: Browser): Promise<BrowserContext> {
		const existingContext = this.contexts.get(sessionId);
		if (existingContext) {
			return existingContext;
		}

		const context = await browser
			.newContext({
				ignoreHTTPSErrors: true,
				viewport: this.project.config.browser.viewport,
				...this.options.contextOptions,
			})
			.catch(() => browser.contexts()[0]);

		if (!context) {
			throw new Error(`Could not create or reuse a Chromium CDP context for session ${sessionId}.`);
		}

		this.contexts.set(sessionId, context);
		return context;
	}

	private getBrowserKey(sessionId: string, parallel: boolean): string {
		return parallel || this.options.browserPerSession ? sessionId : 'default';
	}

	private async waitForLaunchSlot(): Promise<void> {
		const launchDelayMs = this.options.launchDelayMs ?? 0;
		if (launchDelayMs <= 0) {
			return;
		}

		const previousLaunch = this.launchQueue;
		let releaseLaunch!: () => void;
		this.launchQueue = new Promise<void>((resolve) => {
			releaseLaunch = resolve;
		});

		await previousLaunch;

		try {
			const now = Date.now();
			const waitMs = Math.max(0, this.nextLaunchAt - now);
			this.nextLaunchAt = Math.max(this.nextLaunchAt, now) + launchDelayMs;

			if (waitMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}
		} finally {
			releaseLaunch();
		}
	}

	private log(message: string): void {
		if (this.options.logSessions) {
			this.project.vitest.logger.log(`[${this.name}] ${message}`);
		}
	}
}

function getRetryAttempts(options: BrowserCdpRetryOptions | undefined, name: string): number {
	const attempts = options?.attempts ?? 1;
	if (!Number.isInteger(attempts) || attempts < 1) {
		throw new Error(`Invalid ${name}.attempts: expected a positive integer, got ${JSON.stringify(attempts)}.`);
	}

	return attempts;
}

declare module 'vitest/node' {
	export interface BrowserCommandContext {
		page: Page;
		context: BrowserContext;
		frame: () => Promise<Frame>;
		iframe: FrameLocator;
	}
}
