import { cloudflare } from '@cloudflare/vite-plugin';
import { playwright } from '@vitest/browser-playwright';

import { benchmarkTestConfig, localPlaywrightOptions } from './vitest.benchmark.shared';
import { benchmarkStartupTimingPlugin, markBenchmarkStartup } from './vitest.benchmark.startup';

markBenchmarkStartup('local-serial-config-imported');

export default {
	plugins: [benchmarkStartupTimingPlugin(), cloudflare()],
	test: benchmarkTestConfig({
		fileParallelism: false,
		maxWorkers: 1,
		mode: 'local-serial',
		provider: playwright(localPlaywrightOptions()),
		topology: 'local-playwright-serial-debug',
	}),
};
