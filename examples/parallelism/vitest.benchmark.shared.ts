import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export const benchmarkInclude = ['test/browser/scenarios/**/*.browser.test.ts'];

export const browserApiHost = process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0';

export const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');

export const scenarioDelayMs = process.env.VITEST_SCENARIO_DELAY_MS ?? '2200';

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
