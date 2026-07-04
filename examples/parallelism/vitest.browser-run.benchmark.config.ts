import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vitest/config';

import { browserRunCdp } from '@cloudflare/vitest-browser-run-provider';
import { benchmarkInclude, browserApiHost, browserApiPort, loadDotEnv, scenarioDelayMs } from './vitest.benchmark.shared';

loadDotEnv();

const browserRunConcurrency = Number(process.env.CLOUDFLARE_BROWSER_RUN_CONCURRENCY ?? process.env.VITEST_MAX_WORKERS ?? '8');

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
		include: benchmarkInclude,
		fileParallelism: true,
		maxWorkers: browserRunConcurrency,
		env: {
			VITEST_BENCHMARK_MODE: process.env.VITEST_BENCHMARK_MODE ?? 'browser-run',
			VITEST_SCENARIO_DELAY_MS: scenarioDelayMs,
		},
		browser: {
			enabled: true,
			connectTimeout: 180000,
			headless: true,
			fileParallelism: true,
			provider: browserRunCdp(),
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
