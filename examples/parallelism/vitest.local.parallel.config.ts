import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { benchmarkConcurrency, benchmarkInclude, appLatencyMs, localPlaywrightOptions } from './vitest.benchmark.shared';

const localBrowserConcurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? process.env.LOCAL_BROWSER_CONCURRENCY ?? String(benchmarkConcurrency));

export default defineConfig({
	test: {
		include: benchmarkInclude,
		fileParallelism: true,
		maxWorkers: localBrowserConcurrency,
		env: {
			BENCHMARK_APP_LATENCY_MS: appLatencyMs,
			BENCHMARK_CONCURRENCY: String(localBrowserConcurrency),
			VITEST_BENCHMARK_MODE: process.env.VITEST_BENCHMARK_MODE ?? 'local-parallel',
		},
		browser: {
			enabled: true,
			headless: true,
			fileParallelism: true,
			provider: playwright(localPlaywrightOptions()),
			api: {
				allowWrite: true,
			},
			instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
		},
	},
});
