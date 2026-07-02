import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { defineConfig } from 'vitest/config';

import { browserRunCdp } from './test/browser-run-provider';

loadDotEnv();

const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');
const browserRunConcurrency = Number(process.env.CF_BROWSER_RUN_CONCURRENCY ?? process.env.VITEST_MAX_WORKERS ?? '4');

function loadDotEnv(): void {
	if (existsSync('.env')) {
		loadEnvFile('.env');
	}
}

function readBoolean(value: string | undefined, defaultValue = false): boolean {
	if (value == null) {
		return defaultValue;
	}

	return value === '1' || value === 'true';
}

export default defineConfig({
	server: {
		host: process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0',
		port: browserApiPort,
		strictPort: true,
		allowedHosts: true,
	},
	test: {
		include: ['test/browser/**/*.browser.test.ts'],
		fileParallelism: true,
		maxWorkers: browserRunConcurrency,
		browser: {
			enabled: true,
			headless: true,
			fileParallelism: true,
			provider: browserRunCdp({
				accountId: process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID,
				apiToken: process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN,
				wsEndpoint: process.env.CF_BROWSER_RUN_WS_ENDPOINT,
				publicOrigin: process.env.VITEST_BROWSER_PUBLIC_ORIGIN,
				keepAliveMs: Number(process.env.CF_BROWSER_RUN_KEEP_ALIVE_MS ?? '600000'),
				recording: readBoolean(process.env.CF_BROWSER_RUN_RECORDING),
				browserPerSession: readBoolean(process.env.CF_BROWSER_RUN_BROWSER_PER_SESSION, true),
				launchDelayMs: Number(process.env.CF_BROWSER_RUN_LAUNCH_DELAY_MS ?? '1100'),
				logSessions: readBoolean(process.env.CF_BROWSER_RUN_LOG_SESSIONS, true),
			}),
			expect: {
				toMatchScreenshot: {
					comparatorName: 'pixelmatch',
					comparatorOptions: {
						threshold: 0.2,
						allowedMismatchedPixelRatio: 0.005,
					},
				},
			},
			api: {
				host: process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0',
				port: browserApiPort,
				allowExec: true,
				allowWrite: true,
			},
			instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
		},
	},
});
