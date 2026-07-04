import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { cloudflare } from '@cloudflare/vite-plugin';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { browserRunCdp } from '@vitest-browser-run/browser-run-provider';

loadDotEnv();

const browserRunPublicOriginEnv = 'VITEST_BROWSER_PUBLIC_ORIGIN';
const tunnelEnvironmentName = 'browser_run_tunnel';
const browserApiHost = process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0';
const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');
const browserRunConcurrency = Number(process.env.CF_BROWSER_RUN_CONCURRENCY ?? process.env.VITEST_MAX_WORKERS ?? '4');

function loadDotEnv(): void {
	if (existsSync('.env')) {
		loadEnvFile('.env');
	}
}

function cloudflareTunnelVitestBrowserCompat(): Plugin {
	return {
		name: 'browser-run-cloudflare-tunnel-vitest-browser-compat',
		enforce: 'pre',
		configResolved(config) {
			const tunnelEnvironment = config.environments[tunnelEnvironmentName];
			if (tunnelEnvironment) {
				tunnelEnvironment.resolve.external = [];
			}
		},
	};
}

export default defineConfig({
	environments: {
		[tunnelEnvironmentName]: {
			resolve: {
				external: [],
			},
		},
	},
	plugins: [cloudflareTunnelVitestBrowserCompat(), ...cloudflare({
		viteEnvironment: { name: tunnelEnvironmentName },
		tunnel: {
			autoStart: !process.env[browserRunPublicOriginEnv],
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
