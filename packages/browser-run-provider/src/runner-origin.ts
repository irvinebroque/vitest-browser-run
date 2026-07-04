export type BrowserRunnerPublicOrigin = string | (() => string | undefined);

export interface BrowserRunnerWaitOptions {
	attempts?: number;
	intervalMs?: number;
	requestTimeoutMs?: number;
}

export function resolveBrowserRunnerPublicOrigin(publicOrigin: BrowserRunnerPublicOrigin | undefined): string {
	return (typeof publicOrigin === 'function' ? publicOrigin() : publicOrigin) ?? '';
}

export function resolveBrowserRunnerUrl(url: string, publicOrigin: string): string {
	if (!publicOrigin) {
		return url;
	}

	const localUrl = new URL(url);
	const publicUrl = new URL(publicOrigin);
	const pathPrefix = publicUrl.pathname.replace(/\/$/, '');

	localUrl.protocol = publicUrl.protocol;
	localUrl.hostname = publicUrl.hostname;
	localUrl.port = publicUrl.port;
	localUrl.pathname = `${pathPrefix}${localUrl.pathname}`;

	return localUrl.href;
}

export async function waitForLocalBrowserRunner(url: string, options: BrowserRunnerWaitOptions = {}): Promise<void> {
	const attempts = options.attempts ?? 20;
	const intervalMs = options.intervalMs ?? 250;
	const requestTimeoutMs = options.requestTimeoutMs ?? 1000;
	const localUrl = new URL(url);
	if (localUrl.hostname === 'localhost') {
		localUrl.hostname = '127.0.0.1';
	}

	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetch(localUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
			await response.body?.cancel();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}
	}

	throw new Error(`Vitest browser runner did not become reachable at ${localUrl.href}.`, { cause: lastError });
}

export function isTransientBrowserRunnerNavigationError(error: unknown): boolean {
	const message = String(error);
	return message.includes('ERR_CONNECTION_RESET') || message.includes('ERR_CONNECTION_REFUSED');
}
