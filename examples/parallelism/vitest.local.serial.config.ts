import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { appLatencyMs, benchmarkInclude, localPlaywrightOptions } from './vitest.benchmark.shared';

export default defineConfig({
	test: {
		include: benchmarkInclude,
		fileParallelism: false,
		maxWorkers: 1,
		env: {
			BENCHMARK_APP_LATENCY_MS: appLatencyMs,
			VITEST_BENCHMARK_MODE: process.env.VITEST_BENCHMARK_MODE ?? 'local-serial',
		},
		browser: {
			enabled: true,
			headless: true,
			fileParallelism: false,
			provider: playwright(localPlaywrightOptions()),
			api: {
				allowWrite: true,
			},
			instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
		},
	},
});
