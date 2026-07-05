import { cloudflare } from '@cloudflare/vite-plugin';
import { playwright } from '@vitest/browser-playwright';

import { benchmarkSessionsPerBrowser, benchmarkTestConfig, localPlaywrightOptions } from './vitest.benchmark.shared';

const localBrowserSessions = Number(process.env.BENCHMARK_SESSIONS_PER_BROWSER ?? String(benchmarkSessionsPerBrowser));

export default {
	plugins: [cloudflare()],
	test: benchmarkTestConfig({
		env: {
			BENCHMARK_SESSIONS_PER_BROWSER: String(localBrowserSessions),
		},
		maxWorkers: localBrowserSessions,
		mode: 'local-parallel',
		provider: playwright(localPlaywrightOptions()),
		topology: 'local-playwright-default-parallel',
	}),
};
