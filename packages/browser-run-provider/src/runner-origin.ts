export type BrowserRunnerPublicOrigin = string | (() => string | undefined);

export function resolveBrowserRunnerPublicOrigin(publicOrigin: BrowserRunnerPublicOrigin | undefined): string {
	return (typeof publicOrigin === 'function' ? publicOrigin() : publicOrigin) ?? '';
}

export function resolveBrowserRunnerUrl(url: string, publicOrigin: string, requirePublicOrigin = false): string {
	if (!publicOrigin) {
		if (requirePublicOrigin) {
			throw new Error(
				"Missing VITEST_BROWSER_PUBLIC_ORIGIN. This CDP browser cannot reach localhost; expose Vitest's browser API with a tunnel and set its public origin.",
			);
		}

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

export async function waitForLocalBrowserRunner(url: string): Promise<void> {
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

export function isTransientBrowserRunnerNavigationError(error: unknown): boolean {
	const message = String(error);
	return message.includes('ERR_CONNECTION_RESET') || message.includes('ERR_CONNECTION_REFUSED');
}
