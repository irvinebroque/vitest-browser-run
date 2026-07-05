import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactRoot = join(root, 'artifacts/benchmark');

export async function writeBenchmarkReport(requestedModes) {
	await mkdir(artifactRoot, { recursive: true });
	const modes = requestedModes.length ? requestedModes : await listModes();
	const summaries = [];

	for (const mode of modes) {
		const events = await readModeEvents(mode);
		const metadata = await readModeMetadata(mode);
		const startupEvents = await readModeStartupEvents(mode);
		await mkdir(join(artifactRoot, mode), { recursive: true });
		await writeFile(join(artifactRoot, mode, 'benchmark-events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
		summaries.push(summarizeMode(mode, events, metadata, startupEvents));
	}

	await writeFile(join(artifactRoot, 'benchmark-summary.md'), renderMarkdown(summaries));
	await writeFile(join(artifactRoot, 'benchmark-report.html'), renderHtml(summaries));
	return summaries;
}

async function listModes() {
	try {
		const entries = await readdir(artifactRoot, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
	}
	catch {
		return [];
	}
}

async function readModeEvents(mode) {
	const eventsDir = join(artifactRoot, mode, 'events');
	let files = [];
	try {
		files = await readdir(eventsDir);
	}
	catch {
		return [];
	}

	const events = await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
		const content = await readFile(join(eventsDir, file), 'utf8');
		return JSON.parse(content);
	}));

	return events.sort((a, b) => a.startTime - b.startTime || a.scenarioId.localeCompare(b.scenarioId));
}

async function readModeMetadata(mode) {
	try {
		return JSON.parse(await readFile(join(artifactRoot, mode, 'metadata.json'), 'utf8'));
	}
	catch {
		return { mode, status: 'unknown', wallTimeMs: 0 };
	}
}

async function readModeStartupEvents(mode) {
	try {
		const content = await readFile(join(artifactRoot, mode, 'startup-events.jsonl'), 'utf8');
		return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).sort((a, b) => a.timestamp - b.timestamp);
	}
	catch {
		return [];
	}
}

function summarizeMode(mode, events, metadata, startupEvents) {
	const passed = events.filter((event) => event.status === 'passed').length;
	const failed = events.filter((event) => event.status === 'failed').length;
	const wallTimeMs = metadata.wallTimeMs || (events.length ? Math.max(...events.map((event) => event.endTime)) - Math.min(...events.map((event) => event.startTime)) : 0);
	const browserGroups = groupEventsByBrowser(events);
	const timingSummary = summarizeBrowserRunTimings(events, metadata);
	return {
		browserGroups,
		browserSessionCount: browserGroups.length,
		configuredCapacity: configuredCapacity(mode, metadata),
		events,
		failed,
		maxConcurrency: maxConcurrency(events),
		maxPerBrowserConcurrency: browserGroups.length ? Math.max(...browserGroups.map((group) => group.maxConcurrency)) : 0,
		metadata,
		mode,
		passed,
		scenarioCount: events.length,
		startupEvents,
		startupTimingSummary: summarizeBenchmarkStartupTimings(events, metadata, startupEvents, timingSummary),
		timingSummary,
		topology: metadata.benchmarkProviderTopology || 'unknown',
		wallTimeMs,
	};
}

function summarizeBrowserRunTimings(events, metadata) {
	const timedEvents = events.filter((event) => event.browserRunTimings?.openPage);
	if (!timedEvents.length) {
		return null;
	}

	const firstEvent = [...timedEvents].sort((a, b) => a.startTime - b.startTime)[0];
	const openPage = firstEvent.browserRunTimings.openPage ?? {};
	const lease = firstEvent.browserRunTimings.lease ?? {};
	const provider = firstEvent.browserRunTimings.provider ?? {};
	const firstAttempt = lease.sessionAttempts?.[0] ?? {};
	const leaseFirstEvents = groupEventsByBrowser(timedEvents).map((group) => {
		const first = group.events.sort((a, b) => a.startTime - b.startTime)[0];
		return {
			browserLeaseId: group.browserLeaseId,
			browserLeaseIndex: group.browserLeaseIndex,
			browserRunSessionId: group.browserRunSessionId,
			firstEventDeltaMs: duration(metadata.startedAt, first.startTime),
		};
	});

	return {
		setupBeforeFirstEventMs: duration(metadata.startedAt, firstEvent.startTime),
		providerOptionCreatedDeltaMs: duration(metadata.startedAt, provider.providerOptionCreatedAt),
		providerFactoryStartedDeltaMs: duration(metadata.startedAt, provider.providerFactoryStartedAt),
		providerFactoryEndedDeltaMs: duration(metadata.startedAt, provider.providerFactoryEndedAt),
		firstOpenPageStartedDeltaMs: duration(metadata.startedAt, openPage.openPageStartedAt),
		reserveMs: duration(openPage.reserveStartedAt, openPage.reserveEndedAt),
		acquireMs: duration(lease.acquireStartedAt, lease.acquireEndedAt),
		queueWaitMs: duration(firstAttempt.queueStartedAt, firstAttempt.queueEnteredAt),
		acquireSlotWaitMs: duration(firstAttempt.acquireSlotWaitStartedAt, firstAttempt.acquireSlotWaitEndedAt),
		sessionPostMs: duration(firstAttempt.sessionPostStartedAt, firstAttempt.sessionPostEndedAt),
		cdpConnectMs: duration(lease.cdpConnectStartedAt, lease.cdpConnectEndedAt),
		contextMs: duration(openPage.contextStartedAt, openPage.contextEndedAt),
		pageMs: duration(openPage.pageStartedAt, openPage.pageEndedAt),
		waitRunnerMs: duration(openPage.waitRunnerStartedAt, openPage.waitRunnerEndedAt),
		waitPublicOriginMs: duration(openPage.waitPublicOriginStartedAt, openPage.waitPublicOriginEndedAt),
		gotoMs: duration(openPage.gotoStartedAt, openPage.gotoEndedAt),
		openPageTotalMs: duration(openPage.openPageStartedAt, openPage.openPageEndedAt),
		firstEventAfterOpenPageMs: duration(openPage.openPageEndedAt, firstEvent.startTime),
		testHelperAfterOpenPageMs: duration(openPage.openPageEndedAt, firstEvent.benchmarkTimings?.scenarioHelperImportedAt),
		firstEventAfterTestHelperMs: duration(firstEvent.benchmarkTimings?.scenarioHelperImportedAt, firstEvent.startTime),
		leaseFirstEvents,
	};
}

function summarizeBenchmarkStartupTimings(events, metadata, startupEvents, timingSummary) {
	if (!startupEvents.length && !timingSummary) {
		return null;
	}

	const configImported = firstStartupEvent(startupEvents, (event) => event.event?.endsWith('config-imported'));
	const configResolved = firstStartupEvent(startupEvents, (event) => event.event === 'vite:config-resolved');
	const configureServerEnd = firstStartupEvent(startupEvents, (event) => event.event === 'vite:configure-server-end');
	const serverListening = firstStartupEvent(startupEvents, (event) => event.event === 'vite:http-listening');
	const vitestInit = firstStartupEvent(startupEvents, (event) => event.event === 'vitest:on-init');
	const testRunStart = firstStartupEvent(startupEvents, (event) => event.event === 'vitest:on-test-run-start');
	const browserInit = firstStartupEvent(startupEvents, (event) => event.event === 'vitest:on-browser-init');
	const firstModuleQueued = firstStartupEvent(startupEvents, (event) => event.event === 'vitest:first-module-queued');
	const firstModuleCollected = firstStartupEvent(startupEvents, (event) => event.event === 'vitest:first-module-collected');
	const firstModuleStart = firstStartupEvent(startupEvents, (event) => event.event === 'vitest:first-module-start');
	const firstCaseReady = firstStartupEvent(startupEvents, (event) => event.event === 'vitest:first-case-ready');
	const firstRequest = firstStartupRequest(startupEvents, metadata, () => true);
	const runnerRequest = firstStartupRequest(startupEvents, metadata, (event) => event.url?.includes('/__vitest_test__/'));
	const iframeDocumentRequest = firstStartupRequest(startupEvents, metadata, (event) => event.url?.startsWith('/?sessionId='));
	const testerBundleRequest = firstStartupRequest(startupEvents, metadata, (event) => event.url?.includes('/__vitest_browser__/tester-'));
	const browserTestRequest = firstStartupRequest(startupEvents, metadata, (event) => event.url?.includes('.browser.test.ts'));
	const helperRequest = firstStartupRequest(startupEvents, metadata, (event) => event.url?.includes('scenario-helper.ts'));
	const firstEvent = events.length ? [...events].sort((a, b) => a.startTime - b.startTime)[0] : null;
	const browserMarks = summarizeBrowserStartupMarks(firstEvent?.benchmarkTimings?.browserRunStartupMarks, metadata);

	return {
		...browserMarks,
		browserInitMs: duration(metadata.startedAt, browserInit?.timestamp),
		browserTestRequest,
		configImportedMs: duration(metadata.startedAt, configImported?.timestamp),
		configResolvedMs: duration(metadata.startedAt, configResolved?.timestamp),
		configureServerEndMs: duration(metadata.startedAt, configureServerEnd?.timestamp),
		firstCaseReadyMs: duration(metadata.startedAt, firstCaseReady?.timestamp),
		firstEventMs: duration(metadata.startedAt, firstEvent?.startTime),
		firstModuleCollectedMs: duration(metadata.startedAt, firstModuleCollected?.timestamp),
		firstModuleQueuedMs: duration(metadata.startedAt, firstModuleQueued?.timestamp),
		firstModuleStartMs: duration(metadata.startedAt, firstModuleStart?.timestamp),
		firstOpenPageStartedMs: timingSummary?.firstOpenPageStartedDeltaMs ?? null,
		firstRequest,
		helperImportedMs: duration(metadata.startedAt, firstEvent?.benchmarkTimings?.scenarioHelperImportedAt),
		helperRequest,
		iframeDocumentRequest,
		providerFactoryStartedMs: timingSummary?.providerFactoryStartedDeltaMs ?? null,
		providerOptionCreatedMs: timingSummary?.providerOptionCreatedDeltaMs ?? null,
		runnerRequest,
		serverListeningMs: duration(metadata.startedAt, serverListening?.timestamp),
		testerBundleRequest,
		testRunStartMs: duration(metadata.startedAt, testRunStart?.timestamp),
		vitestInitMs: duration(metadata.startedAt, vitestInit?.timestamp),
		vitestProcessSpawnedMs: duration(metadata.startedAt, metadata.vitestProcessSpawnedAt),
	};
}

function summarizeBrowserStartupMarks(marks, metadata) {
	const channelMessages = Array.isArray(marks?.channelMessages) ? marks.channelMessages : [];
	const iframeEvents = Array.isArray(marks?.iframeEvents) ? marks.iframeEvents : [];
	const readyMessages = Array.isArray(marks?.iframeReadyMessages) ? marks.iframeReadyMessages : [];
	const readyTimes = readyMessages.map((message) => message.at).filter(Number.isFinite).sort((a, b) => a - b);

	return {
		firstExecuteAckMs: firstChannelMessageMs(channelMessages, metadata, 'ack:execute'),
		firstExecuteResponseMs: firstChannelMessageMs(channelMessages, metadata, 'response:execute'),
		firstExecuteSentMs: firstChannelMessageMs(channelMessages, metadata, 'execute'),
		firstIframeCreatedMs: firstIframeEventMs(iframeEvents, metadata, 'created'),
		firstIframeLoadMs: firstIframeEventMs(iframeEvents, metadata, 'load'),
		firstIframeReadyMs: duration(metadata.startedAt, readyTimes[0]),
		firstPrepareAckMs: firstChannelMessageMs(channelMessages, metadata, 'ack:prepare'),
		firstPrepareResponseMs: firstChannelMessageMs(channelMessages, metadata, 'response:prepare'),
		firstPrepareSentMs: firstChannelMessageMs(channelMessages, metadata, 'prepare'),
		iframeReadyCount: readyTimes.length,
		lastIframeReadyMs: duration(metadata.startedAt, readyTimes.at(-1)),
		runnerDomContentLoadedMs: duration(metadata.startedAt, marks?.domContentLoadedAt),
		runnerInitScriptMs: duration(metadata.startedAt, marks?.initScriptAt),
		runnerLoadMs: duration(metadata.startedAt, marks?.loadAt),
	};
}

function firstIframeEventMs(events, metadata, name) {
	const event = events.find((entry) => entry.event === name && Number.isFinite(entry.at));
	return duration(metadata.startedAt, event?.at);
}

function firstChannelMessageMs(messages, metadata, name) {
	const message = messages.find((entry) => entry.event === name && Number.isFinite(entry.at));
	return duration(metadata.startedAt, message?.at);
}

function firstStartupEvent(events, predicate) {
	return events.find(predicate) ?? null;
}

function firstStartupRequest(events, metadata, predicate) {
	const start = events.find((event) => event.event === 'vite:request-start' && predicate(event));
	if (!start) {
		return null;
	}

	const end = events.find((event) => event.event === 'vite:request-end' && event.id === start.id);
	return {
		durationMs: end?.durationMs ?? null,
		endMs: duration(metadata.startedAt, end?.timestamp),
		method: start.method,
		startMs: duration(metadata.startedAt, start.timestamp),
		statusCode: end?.statusCode ?? null,
		url: start.url,
	};
}

function duration(start, end) {
	return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

function configuredCapacity(mode, metadata) {
	if (mode === 'local-serial') {
		return 1;
	}

	if (mode === 'local-parallel') {
		return positiveNumber(metadata.benchmarkSessionsPerBrowser);
	}

	const maxBrowsers = positiveNumber(metadata.browserRunMaxBrowsers);
	const sessionsPerBrowser = positiveNumber(metadata.browserRunSessionsPerBrowser);
	return maxBrowsers && sessionsPerBrowser ? maxBrowsers * sessionsPerBrowser : 0;
}

function positiveNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : 0;
}

function groupEventsByBrowser(events) {
	const groups = new Map();
	for (const event of events) {
		const key = browserGroupKey(event);
		if (!key) {
			continue;
		}

		const group = groups.get(key) ?? {
			browserLeaseId: event.browserLeaseId,
			browserLeaseIndex: event.browserLeaseIndex,
			browserRunSessionId: event.browserRunSessionId,
			events: [],
			key,
			maxConcurrency: 0,
		};
		group.events.push(event);
		groups.set(key, group);
	}

	return Array.from(groups.values()).map((group) => ({
		...group,
		maxConcurrency: maxConcurrency(group.events),
	})).sort((a, b) => Number(a.browserLeaseIndex ?? 0) - Number(b.browserLeaseIndex ?? 0) || a.key.localeCompare(b.key));
}

function browserGroupKey(event) {
	if (event.browserRunSessionId) {
		return event.browserRunSessionId;
	}

	if (event.browserLeaseId != null) {
		return `lease-${event.browserLeaseId}`;
	}

	return '';
}

function maxConcurrency(events) {
	const points = [];
	for (const event of events) {
		points.push([event.startTime, 1]);
		points.push([event.endTime, -1]);
	}

	points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let active = 0;
	let peak = 0;
	for (const [, delta] of points) {
		active += delta;
		peak = Math.max(peak, active);
	}

	return peak;
}

function renderMarkdown(summaries) {
	const browserRunBaseline = summaries.find((summary) => summary.mode === 'browser-run-single');
	const rows = summaries.map((summary) => {
		return `| ${summary.mode} | ${summary.topology} | ${summary.scenarioCount} | ${formatCount(summary.browserSessionCount)} | ${formatCount(summary.configuredCapacity)} | ${summary.maxConcurrency} | ${formatCount(summary.maxPerBrowserConcurrency)} | ${formatDuration(summary.wallTimeMs)} | ${browserRunSpeedup(summary, browserRunBaseline)} | ${summary.passed}/${summary.failed} |`;
	});

	return `# Browser Benchmark Summary

Local mode is a context row. Browser Run speedup is measured against \`browser-run-single\`, not local Chrome.

| Mode | Provider/topology | Scenarios | Browser sessions | Configured capacity | Observed overlap | Max/browser | Wall time | Browser Run speedup | Passed/failed |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
${renderTimingMarkdown(summaries)}
${renderStartupMarkdown(summaries)}
${renderReporterMarkdown(summaries)}
${renderBrowserStartupMarkdown(summaries)}
${renderIframeStartupMarkdown(summaries)}
`;
}

function renderTimingMarkdown(summaries) {
	const rows = summaries.filter((summary) => summary.timingSummary).map((summary) => {
		const timing = summary.timingSummary;
		return `| ${summary.mode} | ${formatDuration(timing.setupBeforeFirstEventMs)} | ${formatDuration(timing.firstOpenPageStartedDeltaMs)} | ${formatDuration(timing.reserveMs)} | ${formatDuration(timing.acquireMs)} | ${formatDuration(timing.sessionPostMs)} | ${formatDuration(timing.cdpConnectMs)} | ${formatDuration(timing.waitRunnerMs)} | ${formatDuration(timing.gotoMs)} | ${formatDuration(timing.firstEventAfterOpenPageMs)} | ${formatDuration(timing.testHelperAfterOpenPageMs)} | ${formatDuration(timing.firstEventAfterTestHelperMs)} |`;
	});

	if (!rows.length) {
		return '';
	}

	return `
## Browser Run First-Event Timing

These timings come from the first benchmark event per mode and split the opaque setup-before-first-event bucket into provider phases.

| Mode | Setup before first event | First openPage starts | Reserve lease | Acquire browser | Browser Run POST | CDP connect | Runner wait | Goto runner | First event after openPage | Test helper after openPage | First event after helper |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
`;
}

function renderBrowserStartupMarkdown(summaries) {
	const rows = summaries.filter((summary) => summary.startupTimingSummary).map((summary) => {
		const timing = summary.startupTimingSummary;
		return `| ${summary.mode} | ${formatDuration(timing.runnerInitScriptMs)} | ${formatDuration(timing.runnerDomContentLoadedMs)} | ${formatDuration(timing.runnerLoadMs)} | ${formatDuration(timing.firstIframeReadyMs)} | ${formatDuration(timing.lastIframeReadyMs)} | ${formatOptionalCount(timing.iframeReadyCount)} | ${formatDuration(timing.firstModuleQueuedMs)} | ${formatDuration(timing.helperImportedMs)} | ${formatDuration(timing.firstEventMs)} |`;
	});

	if (!rows.length) {
		return '';
	}

	return `
## Browser Page Startup Trace

These timings come from marks recorded in the Browser Run page before Vitest Browser Mode starts importing test modules.

| Mode | Init script | DOMContentLoaded | Load | First iframe ready | Last iframe ready | Ready messages | First module queued | Helper imported | First event |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
`;
}

function renderIframeStartupMarkdown(summaries) {
	const rows = summaries.filter((summary) => summary.startupTimingSummary).map((summary) => {
		const timing = summary.startupTimingSummary;
		return `| ${summary.mode} | ${formatDuration(timing.firstIframeCreatedMs)} | ${formatRequestTiming(timing.iframeDocumentRequest)} | ${formatDuration(timing.firstIframeLoadMs)} | ${formatRequestTiming(timing.testerBundleRequest)} | ${formatDuration(timing.firstIframeReadyMs)} | ${formatDuration(timing.firstPrepareSentMs)} | ${formatDuration(timing.firstPrepareAckMs)} | ${formatDuration(timing.firstPrepareResponseMs)} | ${formatDuration(timing.firstExecuteSentMs)} | ${formatDuration(timing.firstExecuteAckMs)} | ${formatDuration(timing.firstModuleQueuedMs)} |`;
	});

	if (!rows.length) {
		return '';
	}

	return `
## Vitest Iframe Startup Trace

These timings split the runner-to-test gap into iframe creation, iframe document load, tester bundle load, Vitest readiness, and prepare/execute handshakes.

| Mode | Iframe element | Iframe document | Iframe load | Tester bundle | Ready message | Prepare sent | Prepare ack | Prepare done | Execute sent | Execute ack | First module queued |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
`;
}

function renderReporterMarkdown(summaries) {
	const rows = summaries.filter((summary) => summary.startupTimingSummary).map((summary) => {
		const timing = summary.startupTimingSummary;
		return `| ${summary.mode} | ${formatDuration(timing.vitestInitMs)} | ${formatDuration(timing.testRunStartMs)} | ${formatDuration(timing.browserInitMs)} | ${formatDuration(timing.firstModuleQueuedMs)} | ${formatDuration(timing.firstModuleCollectedMs)} | ${formatDuration(timing.firstModuleStartMs)} | ${formatDuration(timing.firstCaseReadyMs)} | ${formatDuration(timing.firstOpenPageStartedMs)} | ${formatDuration(timing.firstEventMs)} |`;
	});

	if (!rows.length) {
		return '';
	}

	return `
## Vitest Reporter Trace

These timings come from Vitest reporter hooks and split the internal gap before Browser provider startup.

| Mode | Vitest init | Test run start | Browser init | First module queued | First module collected | First module start | First case ready | First openPage starts | First event |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
`;
}

function renderStartupMarkdown(summaries) {
	const rows = summaries.filter((summary) => summary.startupTimingSummary).map((summary) => {
		const timing = summary.startupTimingSummary;
		return `| ${summary.mode} | ${formatDuration(timing.vitestProcessSpawnedMs)} | ${formatDuration(timing.configImportedMs)} | ${formatDuration(timing.configResolvedMs)} | ${formatDuration(timing.serverListeningMs)} | ${formatRequestTiming(timing.firstRequest)} | ${formatDuration(timing.providerOptionCreatedMs)} | ${formatDuration(timing.providerFactoryStartedMs)} | ${formatDuration(timing.firstOpenPageStartedMs)} | ${formatRequestTiming(timing.runnerRequest)} | ${formatRequestTiming(timing.browserTestRequest)} | ${formatRequestTiming(timing.helperRequest)} | ${formatDuration(timing.helperImportedMs)} | ${formatDuration(timing.firstEventMs)} |`;
	});

	if (!rows.length) {
		return '';
	}

	return `
## Benchmark Startup Trace

Request cells show response-end time relative to benchmark start, with request duration in parentheses.

| Mode | Process spawned | Config imported | Config resolved | Server listening | First request | Provider option created | Provider factory starts | First openPage starts | Runner response | First test module response | Scenario helper response | Helper imported | First event |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
`;
}

function renderHtml(summaries) {
	const browserRunBaseline = summaries.find((summary) => summary.mode === 'browser-run-single');
	const cards = summaries.map((summary) => renderModeCard(summary)).join('\n');

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser benchmark report</title>
  <style>
    :root { font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1180px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; margin: 24px 0; background: white; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    .mode { margin: 28px 0; padding: 20px; border: 1px solid #e2e8f0; border-radius: 18px; background: white; }
    .timeline { position: relative; min-height: 80px; margin-top: 16px; border-radius: 12px; background: #eff6ff; overflow: hidden; }
    .bar { position: absolute; height: 8px; border-radius: 999px; background: #2563eb; }
    .bar.failed { background: #dc2626; }
    code { color: #1d4ed8; }
  </style>
</head>
<body>
	<main>
	    <h1>Browser benchmark report</h1>
	    <p>This report shows the same scenario matrix across benchmark modes under contract <code>${escapeHtml(summaries[0]?.metadata.benchmarkContractId ?? 'unknown')}</code>. Local mode is a context row; Browser Run speedup compares hosted browser pooling against <code>browser-run-single</code>. Timelines show observed file-level overlap, not the configured worker cap.</p>
	    <table>
	      <thead><tr><th>Mode</th><th>Provider/topology</th><th>Scenarios</th><th>Browser sessions</th><th>Configured capacity</th><th>Observed overlap</th><th>Max/browser</th><th>Wall time</th><th>Browser Run speedup</th><th>Passed/failed</th></tr></thead>
	      <tbody>
	        ${summaries.map((summary) => renderSummaryRow(summary, browserRunBaseline)).join('\n')}
	      </tbody>
    </table>
    ${cards}
  </main>
</body>
</html>`;
}

function renderSummaryRow(summary, browserRunBaseline) {
	return `<tr><td><code>${escapeHtml(summary.mode)}</code></td><td><code>${escapeHtml(summary.topology)}</code></td><td>${summary.scenarioCount}</td><td>${formatCount(summary.browserSessionCount)}</td><td>${formatCount(summary.configuredCapacity)}</td><td>${summary.maxConcurrency}</td><td>${formatCount(summary.maxPerBrowserConcurrency)}</td><td>${formatDuration(summary.wallTimeMs)}</td><td>${browserRunSpeedup(summary, browserRunBaseline)}</td><td>${summary.passed}/${summary.failed}</td></tr>`;
}

function renderModeCard(summary) {
	const start = summary.events.length ? Math.min(...summary.events.map((event) => event.startTime)) : 0;
	const span = summary.events.length ? Math.max(...summary.events.map((event) => event.endTime)) - start : 1;
	const bars = summary.events.map((event, index) => {
		const left = ((event.startTime - start) / span) * 100;
		const width = Math.max(((event.endTime - event.startTime) / span) * 100, 0.6);
		const top = 12 + (index % 12) * 12;
		const color = event.status === 'failed' ? '#dc2626' : browserColor(event);
		const title = `${event.scenarioId}${event.browserRunSessionId ? ` | browser ${event.browserLeaseId}: ${event.browserRunSessionId}` : ''}`;
		return `<span class="bar ${event.status === 'failed' ? 'failed' : ''}" style="left: ${left}%; width: ${width}%; top: ${top}px; background: ${color}" title="${escapeHtml(title)}"></span>`;
	}).join('\n');
	const browserBreakdown = summary.browserGroups.length
		? `<ul>${summary.browserGroups.map((group) => `<li>Browser ${escapeHtml(group.browserLeaseId ?? group.key)}: ${group.events.length} scenarios, max observed overlap ${group.maxConcurrency}</li>`).join('')}</ul>`
		: '<p>No provider browser-session metadata was recorded for this mode.</p>';

	return `<section class="mode">
  <h2>${escapeHtml(summary.mode)}</h2>
  <p>Topology <code>${escapeHtml(summary.topology)}</code>. ${summary.scenarioCount} scenarios, ${formatCount(summary.browserSessionCount)} browser sessions, configured capacity ${formatCount(summary.configuredCapacity)}, observed overlap ${summary.maxConcurrency}, max/browser ${formatCount(summary.maxPerBrowserConcurrency)}, wall time ${formatDuration(summary.wallTimeMs)}.</p>
  ${browserBreakdown}
  <div class="timeline" style="height: ${Math.max(96, 24 + Math.min(summary.events.length, 12) * 12)}px">${bars}</div>
</section>`;
}

function browserRunSpeedup(summary, browserRunBaseline) {
	if (!summary.mode.startsWith('browser-run') || !browserRunBaseline?.wallTimeMs || !summary.wallTimeMs) {
		return 'n/a';
	}

	return `${(browserRunBaseline.wallTimeMs / summary.wallTimeMs).toFixed(1)}x`;
}

function browserColor(event) {
	const colors = ['#2563eb', '#7c3aed', '#059669', '#ea580c', '#0891b2', '#be123c', '#4f46e5', '#16a34a'];
	const index = Number(event.browserLeaseIndex ?? event.browserLeaseId ?? 0);
	return colors[Math.abs(index) % colors.length];
}

function formatCount(value) {
	return value ? String(value) : 'n/a';
}

function formatOptionalCount(value) {
	return Number.isFinite(value) ? String(value) : 'n/a';
}

function formatRequestTiming(request) {
	if (!request) {
		return 'n/a';
	}

	const end = formatDuration(request.endMs);
	const duration = formatDuration(request.durationMs);
	return duration === 'n/a' ? end : `${end} (${duration})`;
}

function formatDuration(ms) {
	if (ms === 0) {
		return '0s';
	}
	if (!Number.isFinite(ms)) {
		return 'n/a';
	}

	const seconds = ms / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}

	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${(seconds % 60).toFixed(0)}s`;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => {
		switch (character) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			default:
				return '&#39;';
		}
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const summaries = await writeBenchmarkReport(cliModes());
	const browserRunBaseline = summaries.find((summary) => summary.mode === 'browser-run-single');
	for (const summary of summaries) {
		console.log(`${summary.mode}: topology ${summary.topology}, ${summary.scenarioCount} scenarios, ${formatCount(summary.browserSessionCount)} browser sessions, configured capacity ${formatCount(summary.configuredCapacity)}, observed overlap ${summary.maxConcurrency}, max/browser ${formatCount(summary.maxPerBrowserConcurrency)}, wall time ${formatDuration(summary.wallTimeMs)}, Browser Run speedup ${browserRunSpeedup(summary, browserRunBaseline)}`);
	}
}

function cliModes() {
	return process.argv.slice(2).filter((arg) => arg !== '--');
}
