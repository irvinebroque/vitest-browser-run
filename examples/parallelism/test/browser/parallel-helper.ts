import { expect } from 'vitest';
import { cdp, server } from 'vitest/browser';

import { type ParallelJob, parallelJobFor } from '../../src/parallel';

export async function expectSharedBrowserParallelSlot(slot: number): Promise<void> {
	const job = parallelJobFor(slot);
	renderParallelSlot(job);

	const userAgent = await readBrowserUserAgent();
	expect(server.provider).toBe('playwright');
	expect(userAgent).toContain('Chrome');

	const status = getByTestId('parallel-status');
	const phase = getByTestId('parallel-phase');
	const worker = getByTestId('parallel-worker');
	worker.textContent = `Vitest worker ${readMetaEnv('VITEST_WORKER_ID')}`;

	status.textContent = 'running';
	const startedAt = performance.now();
	for (const [index, label] of job.phases.entries()) {
		phase.textContent = `${index + 1}/${job.phases.length}: ${label}`;
		await delay(job.delayMs / job.phases.length);
	}

	status.textContent = 'complete';
	phase.textContent = `${job.label} complete`;

	expect(status.textContent).toBe('complete');
	expect(phase.textContent).toBe(`${job.label} complete`);
	expect(performance.now() - startedAt).toBeGreaterThanOrEqual(job.delayMs * 0.9);
}

function renderParallelSlot(job: ParallelJob): void {
	document.body.innerHTML = `
		<main data-testid="parallel-root" style="font-family: Arial, sans-serif; padding: 32px;">
			<p data-testid="parallel-worker">Vitest worker pending</p>
			<h1>${job.label}</h1>
			<p>This file holds a shared Browser Run Chromium page open long enough to overlap with sibling files.</p>
			<dl>
				<dt>Status</dt>
				<dd data-testid="parallel-status">pending</dd>
				<dt>Phase</dt>
				<dd data-testid="parallel-phase">waiting</dd>
			</dl>
		</main>
	`;
}

async function readBrowserUserAgent(): Promise<string> {
	const result = (await cdp().send('Runtime.evaluate', {
		expression: 'navigator.userAgent',
		returnByValue: true,
	})) as { result: { value: string } };

	return result.result.value;
}

function readMetaEnv(name: string): string {
	const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
	return meta.env?.[name] ?? 'unknown';
}

function getByTestId(testId: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
	expect(element).not.toBeNull();
	return element!;
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
