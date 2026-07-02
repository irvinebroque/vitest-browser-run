import { readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

import { browserRunCdp } from './test/browser-run-provider';

loadDevVars();

const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');
const browserRunConcurrency = Number(process.env.CF_BROWSER_RUN_CONCURRENCY ?? process.env.VITEST_MAX_WORKERS ?? '4');

function loadDevVars(): void {
	let text: string;
	try {
		text = readFileSync('.dev.vars', 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
		return;
	}

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
		const equalsIndex = assignment.indexOf('=');
		if (equalsIndex === -1) {
			continue;
		}

		const key = assignment.slice(0, equalsIndex).trim();
		let value = assignment.slice(equalsIndex + 1).trim();
		if (!key || process.env[key] != null) {
			continue;
		}

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		process.env[key] = value;
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
