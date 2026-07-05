import { cloudflare } from '@cloudflare/vite-plugin';
import { playwright } from '@vitest/browser-playwright';

import { benchmarkTestConfig, localPlaywrightOptions } from './vitest.benchmark.shared';

export default {
	plugins: [cloudflare()],
	test: benchmarkTestConfig({
		fileParallelism: false,
		maxWorkers: 1,
		mode: 'local-serial',
		provider: playwright(localPlaywrightOptions()),
		topology: 'local-playwright-serial-debug',
	}),
};
