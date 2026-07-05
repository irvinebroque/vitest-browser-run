import { cloudflare } from '@cloudflare/vite-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { benchmarkInclude, benchmarkSessionsPerBrowser, localPlaywrightOptions } from './vitest.benchmark.shared';

const localBrowserSessions = Number(process.env.BENCHMARK_SESSIONS_PER_BROWSER ?? String(benchmarkSessionsPerBrowser));

export default defineConfig({
	plugins: [cloudflare()],
	test: {
		include: benchmarkInclude,
		fileParallelism: true,
		maxWorkers: localBrowserSessions,
		env: {
			BENCHMARK_SESSIONS_PER_BROWSER: String(localBrowserSessions),
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
