import { appendFile, readFile } from 'node:fs/promises';

export interface BrowserRunSummaryOptions {
	publicOrigin: string;
	durationMs: number;
	summary?: boolean;
}

export async function writeBrowserRunSummary(options: BrowserRunSummaryOptions): Promise<void> {
	if (options.summary === false || !process.env.GITHUB_STEP_SUMMARY) {
		return;
	}

	const concurrency = process.env.CF_BROWSER_RUN_CONCURRENCY || process.env.VITEST_MAX_WORKERS || '4';
	const recording = process.env.CF_BROWSER_RUN_RECORDING === 'true' ? 'enabled' : 'disabled';
	const attachments = await readAttachmentHint();
	const summary = [
		'### Browser Run Visual Regression',
		'',
		'- Vitest native matcher: `toMatchScreenshot()`',
		'- Browser provider: `browser-run-cdp`',
		`- Remote browser concurrency: \`${concurrency}\``,
		`- Browser Run recording: \`${recording}\``,
		`- Public Vitest browser origin: \`${options.publicOrigin || 'provided by local config'}\``,
		`- Duration: \`${(options.durationMs / 1000).toFixed(1)}s\``,
		attachments,
		'',
	].filter(Boolean).join('\n');

	await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

async function readAttachmentHint(): Promise<string> {
	try {
		await readFile('.vitest-attachments/.gitkeep');
		return '- Visual diff artifacts: `.vitest-attachments/`';
	} catch {
		return '- Visual diff artifacts: uploaded when Vitest creates `.vitest-attachments/`';
	}
}
