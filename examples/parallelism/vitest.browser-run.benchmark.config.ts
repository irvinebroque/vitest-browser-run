import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vitest/config';

import { browserRunCdp } from '@cloudflare/vitest-browser-run-provider';
import {
	benchmarkConcurrency,
	benchmarkInclude,
	appLatencyMs,
	browserApiHost,
	browserApiPort,
	browserRunAcquireIntervalMs,
	browserRunConcurrency,
	browserRunMaxBrowsers,
	browserRunSessionsPerBrowser,
	loadDotEnv,
} from './vitest.benchmark.shared';

loadDotEnv();

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
			BENCHMARK_APP_LATENCY_MS: appLatencyMs,
			BENCHMARK_CONCURRENCY: String(benchmarkConcurrency),
			CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS: String(browserRunMaxBrowsers),
			CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER: String(browserRunSessionsPerBrowser),
			VITEST_BENCHMARK_MODE: process.env.VITEST_BENCHMARK_MODE ?? 'browser-run',
		},
		browser: {
			enabled: true,
			connectTimeout: 180000,
			headless: true,
			fileParallelism: true,
			provider: browserRunCdp({
				pool: {
					acquireIntervalMs: browserRunAcquireIntervalMs,
					maxBrowsers: browserRunMaxBrowsers,
					sessionsPerBrowser: browserRunSessionsPerBrowser,
				},
			}),
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
