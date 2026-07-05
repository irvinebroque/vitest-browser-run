import { cloudflare } from '@cloudflare/vite-plugin';

import { browserRunCdp } from '@cloudflare/vitest-browser-run-provider';
import {
	benchmarkTestConfig,
	browserApiHost,
	browserApiPort,
	browserRunAcquireIntervalMs,
	browserRunMaxWorkers,
	browserRunMaxBrowsers,
	browserRunSessionsPerBrowser,
	loadDotEnv,
} from './vitest.benchmark.shared';
import { benchmarkStartupTimingPlugin, markBenchmarkStartup } from './vitest.benchmark.startup';

loadDotEnv();
markBenchmarkStartup('browser-run-config-imported');

export default {
	plugins: [benchmarkStartupTimingPlugin(), cloudflare({
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
	test: benchmarkTestConfig({
		api: {
			allowExec: true,
			allowWrite: true,
			host: browserApiHost,
			port: browserApiPort,
		},
		connectTimeout: 180000,
		env: {
			BENCHMARK_SESSIONS_PER_BROWSER: String(browserRunSessionsPerBrowser),
			CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS: String(browserRunMaxBrowsers),
			CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER: String(browserRunSessionsPerBrowser),
		},
		maxWorkers: browserRunMaxWorkers,
		mode: 'browser-run',
		provider: browserRunCdp({
			pool: {
				acquireIntervalMs: browserRunAcquireIntervalMs,
				maxBrowsers: browserRunMaxBrowsers,
				prewarm: true,
				sessionsPerBrowser: browserRunSessionsPerBrowser,
			},
		}),
		topology: browserRunMaxBrowsers === 1 ? 'browser-run-single-hosted-browser' : 'browser-run-pooled-hosted-browsers',
	}),
};
