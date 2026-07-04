import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vitest/config';

import { browserRunCdp } from '@vitest-browser-run/browser-run-provider';

loadDotEnv();

const browserRunPublicOriginEnv = 'VITEST_BROWSER_PUBLIC_ORIGIN';
const browserApiHost = process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0';
const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');
const browserRunConcurrency = Number(process.env.CF_BROWSER_RUN_CONCURRENCY ?? process.env.VITEST_MAX_WORKERS ?? '4');

function loadDotEnv(): void {
	if (existsSync('.env')) {
		loadEnvFile('.env');
	}
}

export default defineConfig({
	plugins: [cloudflare({
		tunnel: process.env[browserRunPublicOriginEnv]
			? undefined
			: {
				autoStart: true,
				env: browserRunPublicOriginEnv,
			},
	})],
	server: {
		host: browserApiHost,
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
			provider: browserRunCdp(),
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
				host: browserApiHost,
				port: browserApiPort,
				allowExec: true,
				allowWrite: true,
			},
			instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
		},
	},
});
