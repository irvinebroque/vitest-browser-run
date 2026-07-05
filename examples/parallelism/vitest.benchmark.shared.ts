import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import type { BrowserProviderOption } from 'vitest/node';

import { benchmarkContract, benchmarkContractEnv } from './scripts/benchmark-contract.mjs';

export const benchmarkInclude = [benchmarkContract.testCorpus];

type BenchmarkMode = 'browser-run' | 'browser-run-single' | 'local-parallel' | 'local-serial';

interface BenchmarkTestConfigOptions {
	api?: {
		allowExec?: boolean;
		allowWrite: boolean;
		host?: string;
		port?: number;
	};
	connectTimeout?: number;
	env?: Record<string, string>;
	fileParallelism?: boolean;
	maxWorkers: number;
	mode: BenchmarkMode;
	provider: BrowserProviderOption;
	topology: string;
}

export const browserApiHost = process.env.VITEST_BROWSER_API_HOST ?? '0.0.0.0';

export const browserApiPort = Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');

export const benchmarkSessionsPerBrowser = Number(
	process.env.BENCHMARK_SESSIONS_PER_BROWSER
	?? process.env.CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER
	?? '4',
);

export const browserRunMaxBrowsers = Number(process.env.CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS ?? '4');

export const browserRunSessionsPerBrowser = Number(
	process.env.CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER
	?? String(benchmarkSessionsPerBrowser),
);

export const browserRunAcquireIntervalMs = Number(process.env.CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS ?? '1000');

export const browserRunMaxWorkers = browserRunMaxBrowsers * browserRunSessionsPerBrowser;

export function benchmarkTestConfig(options: BenchmarkTestConfigOptions) {
	const fileParallelism = options.fileParallelism ?? true;
	return {
		include: benchmarkInclude,
		fileParallelism,
		maxWorkers: options.maxWorkers,
		env: {
			...benchmarkContractEnv(options.topology),
			VITEST_BENCHMARK_MODE: process.env.VITEST_BENCHMARK_MODE ?? options.mode,
			...options.env,
		},
		browser: {
			enabled: true,
			...(options.connectTimeout ? { connectTimeout: options.connectTimeout } : {}),
			headless: true,
			fileParallelism,
			provider: options.provider,
			api: options.api ?? {
				allowWrite: true,
			},
			instances: [{ browser: benchmarkContract.browserName, viewport: { width: 1280, height: 800 } }],
		},
	};
}

export function loadDotEnv(): void {
	for (const envPath of ['.env', '../../.env']) {
		if (existsSync(envPath)) {
			loadEnvFile(envPath);
			return;
		}
	}
}

export function localPlaywrightOptions(): { launchOptions?: { channel?: string } } {
	const channel = process.env.LOCAL_BROWSER_CHANNEL ?? 'chrome';
	return channel ? { launchOptions: { channel } } : {};
}
