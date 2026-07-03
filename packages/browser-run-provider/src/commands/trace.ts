import type { BrowserCommand } from 'vitest/node';

function unsupportedTraceCommand(command: string): BrowserCommand<any> {
	return ({ provider }) => {
		throw new TypeError(
			`The ${provider.name} provider does not support Playwright tracing command ${command} over CDP yet. Disable browser.trace or use @vitest/browser-playwright for tracing.`,
		);
	};
}

export const startTracing = unsupportedTraceCommand('__vitest_startTracing');
export const startChunkTrace = unsupportedTraceCommand('__vitest_startChunkTrace');
export const stopChunkTrace = unsupportedTraceCommand('__vitest_stopChunkTrace');
export const deleteTracing = unsupportedTraceCommand('__vitest_deleteTracing');
export const annotateTraces = unsupportedTraceCommand('__vitest_annotateTraces');
export const markTrace = unsupportedTraceCommand('__vitest_markTrace');
export const groupTraceStart = unsupportedTraceCommand('__vitest_groupTraceStart');
export const groupTraceEnd = unsupportedTraceCommand('__vitest_groupTraceEnd');
