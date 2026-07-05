import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { benchmarkContractEnv } from './benchmark-contract.mjs';
import { writeBenchmarkReport } from './write-benchmark-report.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactRoot = join(root, 'artifacts/benchmark');
const benchmarkSessionsPerBrowser = readBenchmarkSessionsPerBrowser();
const browserRunBenchmarkSessionsPerBrowser = readBrowserRunSessionsPerBrowser();
const browserRunBenchmarkBrowsers = readPositiveIntegerEnv('CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS', 4);

const modeConfigs = {
	'browser-run': {
		comparable: true,
		config: 'vitest.browser-run.benchmark.config.ts',
		env: () => ({
			...benchmarkContractEnv(browserRunTopology(browserRunBenchmarkBrowsers)),
			...browserRunModeEnv(browserRunBenchmarkBrowsers),
		}),
		mode: 'browser-run',
		prepare: true,
	},
	'browser-run-single': {
		comparable: true,
		config: 'vitest.browser-run.benchmark.config.ts',
		env: () => ({
			...benchmarkContractEnv(browserRunTopology(1)),
			...browserRunModeEnv(1),
		}),
		mode: 'browser-run-single',
		prepare: true,
	},
	'local-parallel': {
		comparable: true,
		config: 'vitest.local.parallel.config.ts',
		env: () => ({
			...benchmarkContractEnv('local-playwright-default-parallel'),
			BENCHMARK_SESSIONS_PER_BROWSER: String(benchmarkSessionsPerBrowser),
		}),
		mode: 'local-parallel',
		prepare: false,
	},
	'local-serial': {
		comparable: false,
		config: 'vitest.local.serial.config.ts',
		env: () => benchmarkContractEnv('local-playwright-serial-debug'),
		mode: 'local-serial',
		prepare: false,
	},
};

const cliModes = process.argv.slice(2).filter((arg) => arg !== '--');
const modes = cliModes.length ? cliModes : ['local-parallel', 'browser-run-single', 'browser-run'];
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
		let vitestRunTiming = null;

		try {
			vitestRunTiming = await run('pnpm', ['exec', 'vitest', 'run', '--config', config.config], {
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
			benchmarkAppRoutePattern: childEnv.BENCHMARK_APP_ROUTE_PATTERN ?? '',
			benchmarkAppRuntime: childEnv.BENCHMARK_APP_RUNTIME ?? '',
			benchmarkBrowserMode: childEnv.BENCHMARK_BROWSER_MODE ?? '',
			benchmarkBrowserName: childEnv.BENCHMARK_BROWSER_NAME ?? '',
			benchmarkBrowserSessionStartupConcurrency: childEnv.BENCHMARK_BROWSER_SESSION_STARTUP_CONCURRENCY ?? '',
			benchmarkContractId: childEnv.BENCHMARK_CONTRACT_ID ?? '',
			benchmarkProviderTopology: childEnv.BENCHMARK_PROVIDER_TOPOLOGY ?? '',
			benchmarkSessionsPerBrowser: childEnv.BENCHMARK_SESSIONS_PER_BROWSER ?? '',
			benchmarkTestCorpus: childEnv.BENCHMARK_TEST_CORPUS ?? '',
			benchmarkViewport: childEnv.BENCHMARK_VIEWPORT ?? '',
			browserRunMaxBrowsers: childEnv.CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS ?? '',
			browserRunSessionsPerBrowser: childEnv.CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER ?? '',
			endedAt: Date.now(),
			errorMessage,
			mode,
			scenarioCount: process.env.BENCHMARK_SCENARIO_COUNT ?? '',
			scenarioProfile: process.env.BENCHMARK_SCENARIO_PROFILE ?? process.env.BENCHMARK_PROFILE ?? 'default',
			startedAt,
			status,
			vitestProcessExitedAt: vitestRunTiming?.exitedAt ?? null,
			vitestProcessSpawnedAt: vitestRunTiming?.spawnedAt ?? null,
			wallTimeMs: Math.round(performance.now() - start),
		}, null, 2)}\n`);
	}

	const summaries = await writeBenchmarkReport(modes);
	const browserRunBaseline = summaries.find((summary) => summary.mode === 'browser-run-single');
	assertBenchmarkContract(summaries);

	console.log('\nBenchmark summary');
	console.log('Mode                  Provider/topology                         Scenarios  Browsers  Capacity  Observed overlap  Max/browser  Wall time  Browser Run speedup');
	for (const summary of summaries) {
		console.log(`${summary.mode.padEnd(22)}${summary.topology.padEnd(42)}${String(summary.scenarioCount).padStart(9)}${formatCount(summary.browserSessionCount).padStart(10)}${formatCount(summary.configuredCapacity).padStart(10)}${String(summary.maxConcurrency).padStart(18)}${formatCount(summary.maxPerBrowserConcurrency).padStart(13)}${formatDuration(summary.wallTimeMs).padStart(11)}${browserRunSpeedup(summary, browserRunBaseline).padStart(21)}`);
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
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			env: options.env ?? process.env,
			stdio: 'inherit',
		});
		const spawnedAt = Date.now();

		child.on('error', reject);
		child.on('exit', (code) => {
			const exitedAt = Date.now();
			if (code === 0) {
				resolve({ exitedAt, spawnedAt });
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

function browserRunSpeedup(summary, browserRunBaseline) {
	if (!summary.mode.startsWith('browser-run') || !browserRunBaseline?.wallTimeMs || !summary.wallTimeMs) {
		return 'n/a';
	}

	return `${(browserRunBaseline.wallTimeMs / summary.wallTimeMs).toFixed(1)}x`;
}

function browserRunModeEnv(maxBrowsers) {
	return {
		...(process.env.BENCHMARK_BROWSER_SESSION_STARTUP_CONCURRENCY
			? {
				BENCHMARK_BROWSER_SESSION_STARTUP_CONCURRENCY: String(
					readPositiveIntegerEnv('BENCHMARK_BROWSER_SESSION_STARTUP_CONCURRENCY', maxBrowsers),
				),
			}
			: {}),
		BENCHMARK_SESSIONS_PER_BROWSER: String(browserRunBenchmarkSessionsPerBrowser),
		CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS: String(maxBrowsers),
		CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER: String(browserRunBenchmarkSessionsPerBrowser),
	};
}

function browserRunTopology(maxBrowsers) {
	return maxBrowsers === 1 ? 'browser-run-single-hosted-browser' : 'browser-run-pooled-hosted-browsers';
}

function assertBenchmarkContract(summaries) {
	const comparable = summaries.filter((summary) => modeConfigs[summary.mode]?.comparable);
	if (comparable.length < 2) {
		return;
	}

	const [baseline, ...rest] = comparable;
	const baselineContractId = baseline.metadata.benchmarkContractId;
	const baselineTestCorpus = baseline.metadata.benchmarkTestCorpus;
	const baselineScenarioIds = scenarioIds(baseline);

	if (!baselineContractId || !baselineTestCorpus) {
		throw new Error(`Benchmark mode ${baseline.mode} did not record the execution contract metadata.`);
	}
	assertModeEventsMatchContract(baseline);

	for (const summary of rest) {
		assertModeEventsMatchContract(summary);

		if (summary.metadata.benchmarkContractId !== baselineContractId) {
			throw new Error(`Benchmark mode ${summary.mode} used contract ${summary.metadata.benchmarkContractId || 'unknown'}, expected ${baselineContractId}.`);
		}

		if (summary.metadata.benchmarkTestCorpus !== baselineTestCorpus) {
			throw new Error(`Benchmark mode ${summary.mode} used test corpus ${summary.metadata.benchmarkTestCorpus || 'unknown'}, expected ${baselineTestCorpus}.`);
		}

		const currentScenarioIds = scenarioIds(summary);
		const missing = baselineScenarioIds.filter((id) => !currentScenarioIds.includes(id));
		const extra = currentScenarioIds.filter((id) => !baselineScenarioIds.includes(id));
		if (missing.length || extra.length) {
			throw new Error(`Benchmark mode ${summary.mode} did not run the same scenario set as ${baseline.mode}. Missing: ${formatScenarioDiff(missing)}. Extra: ${formatScenarioDiff(extra)}.`);
		}
	}
}

function assertModeEventsMatchContract(summary) {
	const contractId = summary.metadata.benchmarkContractId;
	const testCorpus = summary.metadata.benchmarkTestCorpus;
	const mismatchedEvent = summary.events.find((event) => event.benchmarkContractId !== contractId || event.benchmarkTestCorpus !== testCorpus);
	if (mismatchedEvent) {
		throw new Error(`Benchmark mode ${summary.mode} wrote event ${mismatchedEvent.scenarioId} with contract ${mismatchedEvent.benchmarkContractId || 'unknown'} and corpus ${mismatchedEvent.benchmarkTestCorpus || 'unknown'}, expected ${contractId} and ${testCorpus}.`);
	}
}

function scenarioIds(summary) {
	return summary.events.map((event) => event.scenarioId).sort();
}

function formatScenarioDiff(ids) {
	if (!ids.length) {
		return 'none';
	}

	return ids.slice(0, 5).join(', ') + (ids.length > 5 ? `, and ${ids.length - 5} more` : '');
}

function readBenchmarkSessionsPerBrowser() {
	if (process.env.BENCHMARK_SESSIONS_PER_BROWSER) {
		return readPositiveIntegerEnv('BENCHMARK_SESSIONS_PER_BROWSER', 4);
	}

	return 4;
}

function readBrowserRunSessionsPerBrowser() {
	if (process.env.BENCHMARK_SESSIONS_PER_BROWSER) {
		return readPositiveIntegerEnv('BENCHMARK_SESSIONS_PER_BROWSER', 2);
	}

	return readPositiveIntegerEnv('CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER', 2);
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
