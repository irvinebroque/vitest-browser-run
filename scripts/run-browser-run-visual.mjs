import { appendFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

await loadDevVars();

const browserApiPort = process.env.VITEST_BROWSER_API_PORT || '63315';
const visualTestFiles = [
	'test/browser/visual-dashboard.browser.test.ts',
	'test/browser/visual-parallel.browser.test.ts',
	'test/browser/visual-review.browser.test.ts',
];
const vitestArgs = ['vitest', 'run', '--config', 'vitest.browser-run.config.ts', ...visualTestFiles, ...process.argv.slice(2)];

let tunnelProcess;

try {
	const publicOrigin = process.env.VITEST_BROWSER_PUBLIC_ORIGIN || await startTunnel();
	const startedAt = Date.now();
	const result = await run('npx', vitestArgs, {
		...process.env,
		VITEST_BROWSER_PUBLIC_ORIGIN: publicOrigin,
	});
	const durationMs = Date.now() - startedAt;

	await writeSummary({ publicOrigin, durationMs, exitCode: result });
	process.exitCode = result;
} finally {
	stopTunnel();
}

function stopTunnel() {
	if (tunnelProcess) {
		tunnelProcess.kill('SIGTERM');
		tunnelProcess = undefined;
	}
}

async function startTunnel() {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error('Timed out waiting for cloudflared to create and register a trycloudflare.com tunnel.'));
		}, 45_000);

		tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${browserApiPort}`, '--no-autoupdate'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let output = '';
		let publicOrigin;
		let registered = false;
		let resolved = false;

		const maybeResolve = () => {
			if (!resolved && publicOrigin && registered) {
				resolved = true;
				clearTimeout(timeout);
				resolve(publicOrigin);
			}
		};

		const onData = (chunk) => {
			const text = chunk.toString();
			output += text;
			process.stderr.write(text);

			const match = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i) ?? output.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
			if (match) {
				publicOrigin = match[0];
				maybeResolve();
			}

			if (text.includes('Registered tunnel connection')) {
				registered = true;
				maybeResolve();
			}
		};

		tunnelProcess.stdout.on('data', onData);
		tunnelProcess.stderr.on('data', onData);
		tunnelProcess.on('error', (error) => {
			clearTimeout(timeout);
			reject(new Error(`Failed to start cloudflared. Install cloudflared or set VITEST_BROWSER_PUBLIC_ORIGIN. ${error.message}`));
		});
		tunnelProcess.on('exit', (code) => {
			if (!output.includes('trycloudflare.com')) {
				clearTimeout(timeout);
				reject(new Error(`cloudflared exited before creating a tunnel. Exit code: ${code}`));
			}
		});
	});
}

async function loadDevVars() {
	let text;
	try {
		text = await readFile('.dev.vars', 'utf8');
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
		return;
	}

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
		const equalsIndex = assignment.indexOf('=');
		if (equalsIndex === -1) {
			continue;
		}

		const key = assignment.slice(0, equalsIndex).trim();
		let value = assignment.slice(equalsIndex + 1).trim();
		if (!key || process.env[key] != null) {
			continue;
		}

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		process.env[key] = value;
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
