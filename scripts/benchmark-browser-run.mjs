import { appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const concurrencies = (process.env.BROWSER_RUN_BENCHMARK_CONCURRENCY || '1,2,4')
	.split(',')
	.map((value) => Number(value.trim()))
	.filter((value) => Number.isFinite(value) && value > 0);

const results = [];

for (const concurrency of concurrencies) {
	const startedAt = Date.now();
	const exitCode = await run('node', ['scripts/run-browser-run-visual.mjs'], {
		...process.env,
		CF_BROWSER_RUN_CONCURRENCY: String(concurrency),
		VITEST_MAX_WORKERS: String(concurrency),
	});

	results.push({ concurrency, exitCode, durationMs: Date.now() - startedAt });
}

const table = [
	'| Concurrency | Duration | Exit Code |',
	'| ---: | ---: | ---: |',
	...results.map((result) => `| ${result.concurrency} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.exitCode} |`),
].join('\n');

console.log(table);

if (process.env.GITHUB_STEP_SUMMARY) {
	await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Browser Run Parallelism Benchmark\n\n${table}\n`);
}

process.exitCode = results.some((result) => result.exitCode !== 0) ? 1 : 0;

function run(command, args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { env, stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) => resolve(code ?? 1));
	});
}
