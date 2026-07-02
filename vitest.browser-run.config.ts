import { defineConfig } from 'vitest/config';

import { browserRunCdp } from './test/browser-run-provider';

const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');

export default defineConfig({
	test: {
		include: ['test/browser/**/*.browser.test.ts'],
		browser: {
			enabled: true,
			headless: true,
			provider: browserRunCdp({
				accountId: process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID,
				apiToken: process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN,
				wsEndpoint: process.env.CF_BROWSER_RUN_WS_ENDPOINT,
				publicOrigin: process.env.VITEST_BROWSER_PUBLIC_ORIGIN,
				keepAliveMs: Number(process.env.CF_BROWSER_RUN_KEEP_ALIVE_MS ?? '600000'),
				recording: process.env.CF_BROWSER_RUN_RECORDING === 'true',
			}),
			api: {
				host: process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0',
				port: browserApiPort,
				allowExec: true,
				allowWrite: true,
			},
			instances: [{ browser: 'chromium' }],
		},
	},
});
