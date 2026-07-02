import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';

import { expose } from '../vendor/tunnels-sdk/expose.mjs';

loadDotEnv();

const browserApiPort = process.env.VITEST_BROWSER_API_PORT || '63315';
const visualTestFiles = [
	'test/browser/visual-dashboard.browser.test.ts',
	'test/browser/visual-parallel.browser.test.ts',
	'test/browser/visual-review.browser.test.ts',
];
const vitestArgs = ['vitest', 'run', '--config', 'vitest.browser-run.config.ts', ...visualTestFiles, ...process.argv.slice(2)];

let tunnel;

try {
	if (!process.env.VITEST_BROWSER_PUBLIC_ORIGIN) {
		tunnel = await startTunnel();
	}

	const publicOrigin = process.env.VITEST_BROWSER_PUBLIC_ORIGIN || tunnel.url;
	const startedAt = Date.now();
	const result = await run('npx', vitestArgs, {
		...process.env,
		VITEST_BROWSER_PUBLIC_ORIGIN: publicOrigin,
	});
	const durationMs = Date.now() - startedAt;

	await writeSummary({ publicOrigin, durationMs, exitCode: result });
	process.exitCode = result;
} finally {
	await tunnel?.close();
}

async function startTunnel() {
	return expose(Number(browserApiPort), {
		host: '127.0.0.1',
		logTo: process.stderr,
	});
}

function loadDotEnv() {
	if (existsSync('.env')) {
		loadEnvFile('.env');
	}
}

async function run(command, args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env,
			stdio: 'inherit',
		});

		child.on('error', reject);
		child.on('exit', (code, signal) => {
			if (signal) {
				reject(new Error(`${command} exited with signal ${signal}`));
				return;
			}

			resolve(code ?? 1);
		});
	});
}

async function writeSummary({ publicOrigin, durationMs, exitCode }) {
	if (!process.env.GITHUB_STEP_SUMMARY) {
		return;
	}

	const concurrency = process.env.CF_BROWSER_RUN_CONCURRENCY || process.env.VITEST_MAX_WORKERS || '4';
	const recording = process.env.CF_BROWSER_RUN_RECORDING === 'true' ? 'enabled' : 'disabled';
	const attachments = await readAttachmentHint();
	const summary = [
		'### Browser Run Visual Regression',
		'',
		`- Vitest native matcher: \`toMatchScreenshot()\``,
		`- Browser provider: \`browser-run-cdp\``,
		`- Remote browser concurrency: \`${concurrency}\``,
		`- Browser Run recording: \`${recording}\``,
		`- Public Vitest browser origin: \`${publicOrigin}\``,
		`- Duration: \`${(durationMs / 1000).toFixed(1)}s\``,
		`- Exit code: \`${exitCode}\``,
		attachments,
		'',
	].filter(Boolean).join('\n');

	await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

async function readAttachmentHint() {
	try {
		await readFile('.vitest-attachments/.gitkeep');
		return '- Visual diff artifacts: `.vitest-attachments/`';
	} catch {
		return '- Visual diff artifacts: uploaded when Vitest creates `.vitest-attachments/`';
	}
}
