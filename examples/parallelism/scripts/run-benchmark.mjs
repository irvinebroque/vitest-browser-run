import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { writeBenchmarkReport } from './write-benchmark-report.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactRoot = join(root, 'artifacts/benchmark');

const modeConfigs = {
	'browser-run': {
		config: 'vitest.browser-run.benchmark.config.ts',
		mode: 'browser-run',
		prepare: true,
	},
	'local-parallel': {
		config: 'vitest.local.parallel.config.ts',
		mode: 'local-parallel',
		prepare: false,
	},
	'local-serial': {
		config: 'vitest.local.serial.config.ts',
		mode: 'local-serial',
		prepare: false,
	},
};

const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['local-serial', 'local-parallel', 'browser-run'];
const failures = [];

for (const mode of modes) {
	if (!modeConfigs[mode]) {
		throw new Error(`Unknown benchmark mode "${mode}". Expected one of: ${Object.keys(modeConfigs).join(', ')}`);
	}
}

for (const mode of modes) {
	const config = modeConfigs[mode];
	await rm(join(artifactRoot, mode), { force: true, recursive: true });

	if (config.prepare) {
		await run('pnpm', ['build:provider'], { mode });
	}

	const startedAt = Date.now();
	const start = performance.now();
	let status = 'passed';
	let errorMessage = '';

	try {
		await run('pnpm', ['exec', 'vitest', 'run', '--config', config.config], {
			env: {
				...process.env,
				VITEST_BENCHMARK_MODE: config.mode,
			},
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
		endedAt: Date.now(),
		errorMessage,
		mode,
		startedAt,
		status,
		wallTimeMs: Math.round(performance.now() - start),
	}, null, 2)}\n`);
}

const summaries = await writeBenchmarkReport(modes);

console.log('\nBenchmark summary');
console.log('Mode                  Scenarios  Max concurrency  Wall time');
for (const summary of summaries) {
	console.log(`${summary.mode.padEnd(22)}${String(summary.scenarioCount).padStart(9)}${String(summary.maxConcurrency).padStart(17)}${formatDuration(summary.wallTimeMs).padStart(11)}`);
}

if (failures.length) {
	throw new Error(`Benchmark failed:\n${failures.join('\n')}`);
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
