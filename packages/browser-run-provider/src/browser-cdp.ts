import { defineBrowserProvider } from '@vitest/browser';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Frame, type FrameLocator, type Page } from 'playwright-core';
import type { BrowserCommand, BrowserProvider, BrowserProviderOption, TestProject } from 'vitest/node';

import { registerBrowserCdpCommands } from './commands/index.js';
import { isTransientBrowserRunnerNavigationError } from './runner-origin.js';
import type { BrowserCdpSession } from './types.js';

export interface BrowserCdpConnectOptions {
	wsEndpoint: string;
	headers?: Record<string, string>;
	timeout?: number;
}

export interface BrowserCdpConnectContext {
	sessionId: string;
	parallel: boolean;
}

export interface BrowserCdpRunnerContext {
	url: string;
	sessionId: string;
	parallel: boolean;
}

export interface BrowserCdpRunnerOptions {
	resolveUrl?: (context: BrowserCdpRunnerContext) => string | Promise<string>;
	waitForReady?: (context: BrowserCdpRunnerContext) => void | Promise<void>;
}

export type BrowserCdpContextStrategy = 'new' | 'reuse-default-on-failure';

export interface BrowserCdpRetryOptions {
	attempts?: number;
	shouldRetry?: (error: unknown, attempt: number) => boolean;
	delayMs?: (attempt: number, error: unknown) => number;
}

export interface BrowserCdpOptions {
	name?: string;
	connect: (context: BrowserCdpConnectContext) => BrowserCdpConnectOptions | Promise<BrowserCdpConnectOptions>;
	runner?: BrowserCdpRunnerOptions;
	browserPerSession?: boolean;
	launchDelayMs?: number;
	logSessions?: boolean;
	contextOptions?: BrowserContextOptions;
	contextStrategy?: BrowserCdpContextStrategy;
	commands?: Record<string, BrowserCommand>;
	connectRetry?: BrowserCdpRetryOptions;
	navigationRetry?: BrowserCdpRetryOptions;
}

export interface ChromiumCdpOptions extends BrowserCdpOptions {}

export type ChromiumCdpConnectOptions = BrowserCdpConnectOptions;
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
	private closing = false;

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
		await this.throwIfClosing();

		const runnerContext: BrowserCdpRunnerContext = {
			url,
			sessionId,
			parallel: options.parallel,
		};
		const browserUrl = await this.resolveBrowserRunnerUrl(runnerContext);
		this.log(browserUrl === url ? `opening browser runner ${url}` : `opening browser runner ${url} via ${browserUrl}`);

		await this.options.runner?.waitForReady?.(runnerContext);
		await this.throwIfClosing();

		const browser = await this.openBrowser(this.getBrowserKey(sessionId, options.parallel), {
			sessionId,
			parallel: options.parallel,
		});
		await this.throwIfClosing(browser);

		const context = await this.getContext(sessionId, browser);
		await this.throwIfClosing(context);

		const previousPage = this.pages.get(sessionId);

		if (previousPage && !previousPage.isClosed()) {
			await previousPage.close();
		}

		const page = await context.newPage();
		await this.throwIfClosing(page);

		this.pages.set(sessionId, page);
		await this.gotoBrowserRunner(page, browserUrl);
		await this.throwIfClosing(page);
	}

	async getCDPSession(sessionId: string): Promise<BrowserCdpSession> {
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
		};
	}

	async close(): Promise<void> {
		this.closing = true;
		await Promise.allSettled(this.browserPromises.values());
		this.browserPromises.clear();

		for (const page of this.pages.values()) {
			if (!page.isClosed()) {
				await page.close().catch(() => undefined);
			}
		}
		this.pages.clear();

		for (const context of new Set(this.contexts.values())) {
			await context.close().catch(() => undefined);
		}
		this.contexts.clear();

		for (const browser of new Set(this.browsers.values())) {
			if (browser.isConnected()) {
				await browser.close().catch(() => undefined);
			}
		}
		this.browsers.clear();
	}

	private async resolveBrowserRunnerUrl(context: BrowserCdpRunnerContext): Promise<string> {
		return await this.options.runner?.resolveUrl?.(context) ?? context.url;
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
		await this.throwIfClosing();

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
				await this.throwIfClosing();
				await this.waitForLaunchSlot();
				await this.throwIfClosing();
				this.log(`connecting CDP browser ${browserKey}${attempt > 1 ? ` (attempt ${attempt}/${attempts})` : ''}`);

				try {
					const connection = await this.options.connect(context);
					await this.throwIfClosing();

					const browser = await chromium.connectOverCDP(connection.wsEndpoint, {
						headers: connection.headers,
						timeout: connection.timeout,
					});
					await this.throwIfClosing(browser);

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

		const contextOptions: BrowserContextOptions = {
			ignoreHTTPSErrors: true,
			viewport: this.project.config.browser.viewport,
			...this.options.contextOptions,
		};
		const context = await browser.newContext(contextOptions).catch((error: unknown) => {
			if (this.options.contextStrategy !== 'reuse-default-on-failure') {
				throw error;
			}

			return browser.contexts()[0];
		});

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
		await this.throwIfClosing();

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

	private async throwIfClosing(disposable?: { close: () => Promise<void> }): Promise<void> {
		if (!this.closing) {
			return;
		}

		await disposable?.close().catch(() => undefined);
		throw new Error('[vitest] The CDP browser provider was closed.');
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
