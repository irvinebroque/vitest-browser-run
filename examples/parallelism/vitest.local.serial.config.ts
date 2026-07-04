import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { benchmarkInclude, localPlaywrightOptions, scenarioDelayMs } from './vitest.benchmark.shared';

export default defineConfig({
	test: {
		include: benchmarkInclude,
		fileParallelism: false,
		maxWorkers: 1,
		env: {
			VITEST_BENCHMARK_MODE: process.env.VITEST_BENCHMARK_MODE ?? 'local-serial',
			VITEST_SCENARIO_DELAY_MS: scenarioDelayMs,
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
