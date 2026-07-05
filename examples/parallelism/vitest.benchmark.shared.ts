import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export const benchmarkInclude = ['test/browser/scenarios/**/*.browser.test.ts'];

export const browserApiHost = process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0';

export const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');

export const appLatencyMs = process.env.BENCHMARK_APP_LATENCY_MS ?? '1000';

export const benchmarkSessionsPerBrowser = Number(
	process.env.BENCHMARK_SESSIONS_PER_BROWSER
	?? process.env.CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER
	?? '4',
);

export const browserRunMaxBrowsers = Number(process.env.CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS ?? '4');

export const browserRunSessionsPerBrowser = Number(
	process.env.CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER
	?? String(benchmarkSessionsPerBrowser),
);

export const browserRunAcquireIntervalMs = Number(process.env.CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS ?? '1000');

export const browserRunMaxWorkers = browserRunMaxBrowsers * browserRunSessionsPerBrowser;

export function loadDotEnv(): void {
	for (const envPath of ['.env', '../../.env']) {
		if (existsSync(envPath)) {
			loadEnvFile(envPath);
			return;
		}
	}
}

export function localPlaywrightOptions(): { launchOptions?: { channel?: string } } {
	const channel = process.env.LOCAL_BROWSER_CHANNEL ?? 'chrome';
	return channel ? { launchOptions: { channel } } : {};
}
