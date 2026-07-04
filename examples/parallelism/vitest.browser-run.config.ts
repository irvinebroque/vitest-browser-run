import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vitest/config';

import { browserRunCdp } from '@cloudflare/vitest-browser-run-provider';

loadDotEnv();

const browserApiHost = process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0';
const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');
const browserRunConcurrency = Number(process.env.CLOUDFLARE_BROWSER_RUN_CONCURRENCY ?? process.env.VITEST_MAX_WORKERS ?? '8');

function loadDotEnv(): void {
	for (const envPath of ['.env', '../../.env']) {
		if (existsSync(envPath)) {
			loadEnvFile(envPath);
			return;
		}
	}
}

export default defineConfig({
	plugins: [cloudflare({
		tunnel: {
			autoStart: true,
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
			connectTimeout: 180000,
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
