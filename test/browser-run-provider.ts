import { defineBrowserProvider } from '@vitest/browser';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { BrowserProvider, BrowserProviderOption, CDPSession } from 'vitest/node';

export interface BrowserRunCdpOptions {
	accountId?: string;
	apiToken?: string;
	wsEndpoint?: string;
	publicOrigin?: string;
	keepAliveMs?: number;
	recording?: boolean;
}

export function browserRunCdp(options: BrowserRunCdpOptions = {}): BrowserProviderOption<BrowserRunCdpOptions> {
	return defineBrowserProvider({
		name: 'browser-run-cdp',
		supportedBrowser: ['chromium'],
		options,
		providerFactory() {
			return new BrowserRunCdpProvider(options);
		},
	});
}

class BrowserRunCdpProvider implements BrowserProvider {
	name = 'browser-run-cdp';
	supportsParallelism = false;

	private browser: Browser | null = null;
	private browserPromise: Promise<Browser> | null = null;
	private contexts = new Map<string, BrowserContext>();
	private pages = new Map<string, Page>();

	constructor(private options: BrowserRunCdpOptions) {}

	getCommandsContext(): Record<string, never> {
		return {};
	}

	async openPage(sessionId: string, url: string): Promise<void> {
		const browserUrl = this.toPublicBrowserUrl(url);
		const browser = await this.openBrowser();
		const context = await this.getContext(sessionId, browser);
		const previousPage = this.pages.get(sessionId);

		if (previousPage && !previousPage.isClosed()) {
			await previousPage.close();
		}

		const page = await context.newPage();
		this.pages.set(sessionId, page);
		await page.goto(browserUrl, { timeout: 0 });
	}

	async getCDPSession(sessionId: string): Promise<CDPSession> {
		const page = this.pages.get(sessionId);
		if (!page) {
			throw new Error(`Browser Run page for session ${sessionId} was not opened.`);
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
		this.contexts.clear();

		if (this.browser?.isConnected()) {
			await this.browser.close();
		}
		this.browser = null;
		this.browserPromise = null;
	}

	private async openBrowser(): Promise<Browser> {
		if (this.browser?.isConnected()) {
			return this.browser;
		}

		if (!this.browserPromise) {
			this.browserPromise = chromium
				.connectOverCDP(this.getWsEndpoint(), {
					headers: { Authorization: `Bearer ${this.getApiToken()}` },
				})
				.then((browser) => {
					this.browser = browser;
					return browser;
				})
				.finally(() => {
					this.browserPromise = null;
				});
		}

		return this.browserPromise;
	}

	private async getContext(sessionId: string, browser: Browser): Promise<BrowserContext> {
		const existingContext = this.contexts.get(sessionId);
		if (existingContext) {
			return existingContext;
		}

		const context = browser.contexts()[0] ?? (await browser.newContext());
		this.contexts.set(sessionId, context);
		return context;
	}

	private getWsEndpoint(): string {
		if (this.options.wsEndpoint) {
			return this.options.wsEndpoint;
		}

		if (!this.options.accountId) {
			throw new Error('Missing CF_ACCOUNT_ID. Set CF_BROWSER_RUN_WS_ENDPOINT or CF_ACCOUNT_ID before running npm run test:browser-run.');
		}

		const endpoint = new URL(`wss://api.cloudflare.com/client/v4/accounts/${this.options.accountId}/browser-rendering/devtools/browser`);
		endpoint.searchParams.set('keep_alive', String(this.options.keepAliveMs ?? 600000));

		if (this.options.recording) {
			endpoint.searchParams.set('recording', 'true');
		}

		return endpoint.href;
	}

	private getApiToken(): string {
		if (!this.options.apiToken) {
			throw new Error(
				'Missing CF_API_TOKEN. Create a token with Browser Rendering - Edit permission before running npm run test:browser-run.',
			);
		}

		return this.options.apiToken;
	}

	private toPublicBrowserUrl(url: string): string {
		if (!this.options.publicOrigin) {
			throw new Error(
				"Missing VITEST_BROWSER_PUBLIC_ORIGIN. Browser Run cannot reach localhost; expose Vitest's browser API with a tunnel and set its public origin.",
			);
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
