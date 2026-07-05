import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { writeBenchmarkReport } from './write-benchmark-report.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactRoot = join(root, 'artifacts/benchmark');
const benchmarkSessionsPerBrowser = readBenchmarkSessionsPerBrowser();
const browserRunBenchmarkBrowsers = readPositiveIntegerEnv('CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS', 4);

const modeConfigs = {
	'browser-run': {
		config: 'vitest.browser-run.benchmark.config.ts',
		env: () => browserRunModeEnv(browserRunBenchmarkBrowsers),
		mode: 'browser-run',
		prepare: true,
	},
	'browser-run-single': {
		config: 'vitest.browser-run.benchmark.config.ts',
		env: () => browserRunModeEnv(1),
		mode: 'browser-run-single',
		prepare: true,
	},
	'local-parallel': {
		config: 'vitest.local.parallel.config.ts',
		env: () => ({ BENCHMARK_SESSIONS_PER_BROWSER: String(benchmarkSessionsPerBrowser) }),
		mode: 'local-parallel',
		prepare: false,
	},
	'local-serial': {
		config: 'vitest.local.serial.config.ts',
		mode: 'local-serial',
		prepare: false,
	},
};

const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['local-parallel', 'browser-run-single', 'browser-run'];
const failures = [];
const scenarioGenerationEnv = getScenarioGenerationEnv();
let shouldRestoreScenarios = false;

for (const mode of modes) {
	if (!modeConfigs[mode]) {
		throw new Error(`Unknown benchmark mode "${mode}". Expected one of: ${Object.keys(modeConfigs).join(', ')}`);
	}
}

try {
	if (scenarioGenerationEnv) {
		shouldRestoreScenarios = true;
		await run('node', ['scripts/generate-scenarios.mjs'], {
			env: {
				...process.env,
				...scenarioGenerationEnv,
			},
			mode: 'scenarios',
		});
	}

	for (const mode of modes) {
		const config = modeConfigs[mode];
		await rm(join(artifactRoot, mode), { force: true, recursive: true });
		const childEnv = {
			...process.env,
			...config.env?.(),
			VITEST_BENCHMARK_MODE: config.mode,
		};

		if (config.prepare) {
			await run('pnpm', ['build:provider'], { mode });
		}

		const startedAt = Date.now();
		const start = performance.now();
		let status = 'passed';
		let errorMessage = '';

		try {
			await run('pnpm', ['exec', 'vitest', 'run', '--config', config.config], {
				env: childEnv,
				mode,
			});
		}
		catch (error) {
			status = 'failed';
			errorMessage = error instanceof Error ? error.message : String(error);
			failures.push(`${mode}: ${errorMessage}`);
		}

		await mkdir(join(artifactRoot, mode), { recursive: true });
		await writeFile(join(artifactRoot, mode, 'metadata.json'), `${JSON.stringify({
			benchmarkSessionsPerBrowser: childEnv.BENCHMARK_SESSIONS_PER_BROWSER ?? '',
			browserRunMaxBrowsers: childEnv.CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS ?? '',
			browserRunSessionsPerBrowser: childEnv.CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER ?? '',
			endedAt: Date.now(),
			errorMessage,
			mode,
			scenarioCount: process.env.BENCHMARK_SCENARIO_COUNT ?? '',
			scenarioProfile: process.env.BENCHMARK_SCENARIO_PROFILE ?? process.env.BENCHMARK_PROFILE ?? 'default',
			startedAt,
			status,
			wallTimeMs: Math.round(performance.now() - start),
		}, null, 2)}\n`);
	}

	const summaries = await writeBenchmarkReport(modes);

	console.log('\nBenchmark summary');
	console.log('Mode                  Scenarios  Browsers  Max concurrency  Max/browser  Wall time');
	for (const summary of summaries) {
		console.log(`${summary.mode.padEnd(22)}${String(summary.scenarioCount).padStart(9)}${formatCount(summary.browserSessionCount).padStart(10)}${String(summary.maxConcurrency).padStart(17)}${formatCount(summary.maxPerBrowserConcurrency).padStart(13)}${formatDuration(summary.wallTimeMs).padStart(11)}`);
	}

	if (failures.length) {
		throw new Error(`Benchmark failed:\n${failures.join('\n')}`);
	}
}
finally {
	if (shouldRestoreScenarios) {
		await run('node', ['scripts/generate-scenarios.mjs'], {
			env: defaultScenarioEnv(),
			mode: 'restore-scenarios',
		});
	}
}

async function run(command, args, options) {
	console.log(`\n[${options.mode}] ${command} ${args.join(' ')}`);
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			env: options.env ?? process.env,
			stdio: 'inherit',
		});

		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
			}
			else {
				reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
			}
		});
	});
}

function formatDuration(ms) {
	const seconds = ms / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}

	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${(seconds % 60).toFixed(0)}s`;
}

function formatCount(value) {
	return value ? String(value) : 'n/a';
}

function browserRunModeEnv(maxBrowsers) {
	return {
		BENCHMARK_SESSIONS_PER_BROWSER: String(benchmarkSessionsPerBrowser),
		CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS: String(maxBrowsers),
		CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER: String(benchmarkSessionsPerBrowser),
	};
}

function readBenchmarkSessionsPerBrowser() {
	if (process.env.BENCHMARK_SESSIONS_PER_BROWSER) {
		return readPositiveIntegerEnv('BENCHMARK_SESSIONS_PER_BROWSER', 4);
	}

	return readPositiveIntegerEnv('CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER', 4);
}

function readPositiveIntegerEnv(name, fallback) {
	const value = process.env[name];
	if (!value) {
		return fallback;
	}

	const number = Number(value);
	if (!Number.isInteger(number) || number < 1) {
		throw new Error(`Invalid ${name}: expected a positive integer, got ${JSON.stringify(value)}.`);
	}

	return number;
}

function getScenarioGenerationEnv() {
	const profile = process.env.BENCHMARK_SCENARIO_PROFILE ?? process.env.BENCHMARK_PROFILE;
	const count = process.env.BENCHMARK_SCENARIO_COUNT;
	if (!profile && !count) {
		return undefined;
	}

	return {
		...(profile ? { BENCHMARK_PROFILE: profile, BENCHMARK_SCENARIO_PROFILE: profile } : {}),
		...(count ? { BENCHMARK_SCENARIO_COUNT: count } : {}),
	};
}

function defaultScenarioEnv() {
	const env = {
		...process.env,
		BENCHMARK_PROFILE: 'default',
		BENCHMARK_SCENARIO_PROFILE: 'default',
	};
	delete env.BENCHMARK_SCENARIO_COUNT;
	return env;
}
