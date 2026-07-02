import { mkdir } from 'node:fs/promises';
import { dirname, normalize } from 'node:path';

import { defineBrowserProvider, resolveScreenshotPath } from '@vitest/browser';
import { chromium, type Browser, type BrowserContext, type Frame, type FrameLocator, type Page } from 'playwright-core';
import type { BrowserCommand, BrowserCommandContext, BrowserProvider, BrowserProviderOption, CDPSession, TestProject } from 'vitest/node';

const cdpConnectAttempts = 3;

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

export interface ChromiumCdpConnection {
	wsEndpoint: string;
	headers?: Record<string, string>;
}

export interface ChromiumCdpConnectContext {
	sessionId: string;
	parallel: boolean;
}

export interface ChromiumCdpOptions {
	name?: string;
	connect: (context: ChromiumCdpConnectContext) => ChromiumCdpConnection | Promise<ChromiumCdpConnection>;
	publicOrigin?: string;
	requirePublicOrigin?: boolean;
	browserPerSession?: boolean;
	launchDelayMs?: number;
	logSessions?: boolean;
}

export function browserRunCdp(options: BrowserRunCdpOptions = {}): BrowserProviderOption {
	return chromiumCdp({
		name: 'browser-run-cdp',
		publicOrigin: options.publicOrigin,
		requirePublicOrigin: true,
		browserPerSession: options.browserPerSession,
		launchDelayMs: options.launchDelayMs,
		logSessions: options.logSessions,
		connect: () => ({
			wsEndpoint: getBrowserRunWsEndpoint(options),
			headers: { Authorization: `Bearer ${getBrowserRunApiToken(options)}` },
		}),
	});
}

export function chromiumCdp(options: ChromiumCdpOptions): BrowserProviderOption {
	return defineBrowserProvider({
		name: options.name ?? 'chromium-cdp',
		supportedBrowser: ['chromium'],
		options: {},
		providerFactory(project) {
			return new ChromiumCdpProvider(project, options);
		},
	});
}

interface ChromiumCdpCommandContext extends BrowserCommandContext {
	page: Page;
	context: BrowserContext;
	frame: () => Promise<Frame>;
	iframe: FrameLocator;
}

type ScreenshotLocator = SerializedLocator | string;

interface SerializedLocator {
	selector: string;
	locator: string;
}

interface ScreenshotCommandOptions {
	element?: ScreenshotLocator;
	mask?: readonly ScreenshotLocator[];
	target?: 'element' | 'page';
	path?: string;
	save?: boolean;
	[key: string]: unknown;
}

const screenshotCommand: BrowserCommand<[string, ScreenshotCommandOptions], Promise<{ buffer: Buffer; path: string }>> = async (
	context,
	name,
	options = {},
) => {
	const browserContext = context as ChromiumCdpCommandContext;

	if (!browserContext.testPath) {
		throw new Error('Cannot take a screenshot without a test path.');
	}

	const path = resolveScreenshotPath(browserContext.testPath, name, browserContext.project.config, options.path);
	const savePath = options.save ? normalize(path) : undefined;

	if (savePath) {
		await mkdir(dirname(savePath), { recursive: true });
	}

	const { element, mask: maskLocators, target, path: _path, save: _save, base64: _base64, ...screenshotOptions } = options;
	const mask = maskLocators?.map((locator) => getDescribedLocator(browserContext, locator));
	const config = {
		...screenshotOptions,
		mask,
		path: savePath,
	} as Parameters<Page['screenshot']>[0];

	const buffer = element
		? await getDescribedLocator(browserContext, element).screenshot(config)
		: target === 'page'
			? await browserContext.page.screenshot(config)
			: await browserContext.iframe.locator('body').screenshot(config);

	return { buffer, path };
};

const viewportCommand: BrowserCommand<[{ width: number; height: number }], Promise<void>> = async (context, viewport) => {
	await (context as ChromiumCdpCommandContext).page.setViewportSize(viewport);
};

class ChromiumCdpProvider implements BrowserProvider {
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
		private options: ChromiumCdpOptions,
	) {
		this.name = options.name ?? 'chromium-cdp';
		project.browser!.registerCommand('__vitest_takeScreenshot' as never, screenshotCommand as BrowserCommand);
		project.browser!.registerCommand('__vitest_viewport' as never, viewportCommand as BrowserCommand);
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
		const browserUrl = this.toPublicBrowserUrl(url);
		this.log(`opening browser runner ${url} via ${browserUrl}`);
		await this.waitForLocalBrowserRunner(url);
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

	private async gotoBrowserRunner(page: Page, url: string): Promise<void> {
		let lastError: unknown;

		for (let attempt = 1; attempt <= 8; attempt += 1) {
			try {
				await page.goto(url, { timeout: 0 });
				return;
			} catch (error) {
				lastError = error;
				if (attempt === 8 || !isTransientNavigationError(error)) {
					throw error;
				}

				const waitMs = Math.min(attempt * 1000, 5000);
				this.log(`browser runner navigation failed; retrying in ${waitMs}ms`);
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}
		}

		throw lastError;
	}

	private async waitForLocalBrowserRunner(url: string): Promise<void> {
		if (!this.options.publicOrigin) {
			return;
		}

		const localUrl = new URL(url);
		if (localUrl.hostname === 'localhost') {
			localUrl.hostname = '127.0.0.1';
		}

		let lastError: unknown;
		for (let attempt = 1; attempt <= 20; attempt += 1) {
			try {
				const response = await fetch(localUrl, { signal: AbortSignal.timeout(1000) });
				await response.body?.cancel();
				return;
			} catch (error) {
				lastError = error;
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}

		throw new Error(`Vitest browser runner did not become reachable at ${localUrl.href}.`, { cause: lastError });
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

	private getPage(sessionId: string): Page {
		const page = this.pages.get(sessionId);
		if (!page) {
			throw new Error(`Chromium CDP page for session ${sessionId} was not opened.`);
		}
		return page;
	}

	private async openBrowser(browserKey: string, context: ChromiumCdpConnectContext): Promise<Browser> {
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

	private async connectBrowser(browserKey: string, context: ChromiumCdpConnectContext): Promise<Browser> {
		try {
			for (let attempt = 1; attempt <= cdpConnectAttempts; attempt += 1) {
				await this.waitForLaunchSlot();
				this.log(`connecting CDP browser ${browserKey}${attempt > 1 ? ` (attempt ${attempt}/${cdpConnectAttempts})` : ''}`);

				try {
					const connection = await this.options.connect(context);
					const browser = await chromium.connectOverCDP(connection.wsEndpoint, {
						headers: connection.headers,
					});
					this.browsers.set(browserKey, browser);
					this.log(`connected CDP browser ${browserKey}; active browsers: ${this.browsers.size}`);
					return browser;
				} catch (error) {
					if (attempt === cdpConnectAttempts || !isTransientCdpConnectError(error)) {
						throw error;
					}

					const waitMs = Math.min(attempt * 2000, 5000);
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

	private toPublicBrowserUrl(url: string): string {
		if (!this.options.publicOrigin) {
			if (this.options.requirePublicOrigin) {
				throw new Error(
					"Missing VITEST_BROWSER_PUBLIC_ORIGIN. This CDP browser cannot reach localhost; expose Vitest's browser API with a tunnel and set its public origin.",
				);
			}

			return url;
		}

		const localUrl = new URL(url);
		const publicUrl = new URL(this.options.publicOrigin);
		const pathPrefix = publicUrl.pathname.replace(/\/$/, '');

		localUrl.protocol = publicUrl.protocol;
		localUrl.hostname = publicUrl.hostname;
		localUrl.port = publicUrl.port;
		localUrl.pathname = `${pathPrefix}${localUrl.pathname}`;

		return localUrl.href;
	}
}

function getDescribedLocator(context: ChromiumCdpCommandContext, locator: ScreenshotLocator): ReturnType<FrameLocator['locator']> {
	if (typeof locator === 'string') {
		return context.iframe.locator(locator);
	}

	const playwrightLocator = context.iframe.locator(locator.selector);
	return typeof playwrightLocator.describe === 'function' ? playwrightLocator.describe(locator.locator) : playwrightLocator;
}

function getBrowserRunWsEndpoint(options: BrowserRunCdpOptions): string {
	if (options.wsEndpoint) {
		return options.wsEndpoint;
	}

	if (!options.accountId) {
		throw new Error('Missing CF_ACCOUNT_ID. Set CF_BROWSER_RUN_WS_ENDPOINT or CF_ACCOUNT_ID before running Browser Run tests.');
	}

	const endpoint = new URL(`wss://api.cloudflare.com/client/v4/accounts/${options.accountId}/browser-rendering/devtools/browser`);
	endpoint.searchParams.set('keep_alive', String(options.keepAliveMs ?? 600000));

	if (options.recording) {
		endpoint.searchParams.set('recording', 'true');
	}

	return endpoint.href;
}

function getBrowserRunApiToken(options: BrowserRunCdpOptions): string {
	if (!options.apiToken) {
		throw new Error('Missing CF_API_TOKEN. Create a token with Browser Rendering - Edit permission before running Browser Run tests.');
	}

	return options.apiToken;
}

function isTransientNavigationError(error: unknown): boolean {
	const message = String(error);
	return message.includes('ERR_CONNECTION_RESET') || message.includes('ERR_CONNECTION_REFUSED');
}

function isTransientCdpConnectError(error: unknown): boolean {
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
