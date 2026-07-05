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
		await mkdir(join(artifactRoot, mode), { recursive: true });
		await writeFile(join(artifactRoot, mode, 'benchmark-events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
		summaries.push(summarizeMode(mode, events, metadata));
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

function summarizeMode(mode, events, metadata) {
	const passed = events.filter((event) => event.status === 'passed').length;
	const failed = events.filter((event) => event.status === 'failed').length;
	const wallTimeMs = metadata.wallTimeMs || (events.length ? Math.max(...events.map((event) => event.endTime)) - Math.min(...events.map((event) => event.startTime)) : 0);
	const browserGroups = groupEventsByBrowser(events);
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
		wallTimeMs,
	};
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
		return `| ${summary.mode} | ${summary.scenarioCount} | ${formatCount(summary.browserSessionCount)} | ${formatCount(summary.configuredCapacity)} | ${summary.maxConcurrency} | ${formatCount(summary.maxPerBrowserConcurrency)} | ${formatDuration(summary.wallTimeMs)} | ${browserRunSpeedup(summary, browserRunBaseline)} | ${summary.passed}/${summary.failed} |`;
	});

	return `# Browser Benchmark Summary

Local mode is a context row. Browser Run speedup is measured against \`browser-run-single\`, not local Chrome.

| Mode | Scenarios | Browser sessions | Configured capacity | Observed overlap | Max/browser | Wall time | Browser Run speedup | Passed/failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
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
	    <p>This report shows the same scenario matrix across benchmark modes. Local mode is a context row; Browser Run speedup compares hosted browser pooling against <code>browser-run-single</code>. Timelines show observed file-level overlap, not the configured worker cap.</p>
	    <table>
	      <thead><tr><th>Mode</th><th>Scenarios</th><th>Browser sessions</th><th>Configured capacity</th><th>Observed overlap</th><th>Max/browser</th><th>Wall time</th><th>Browser Run speedup</th><th>Passed/failed</th></tr></thead>
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
	return `<tr><td><code>${escapeHtml(summary.mode)}</code></td><td>${summary.scenarioCount}</td><td>${formatCount(summary.browserSessionCount)}</td><td>${formatCount(summary.configuredCapacity)}</td><td>${summary.maxConcurrency}</td><td>${formatCount(summary.maxPerBrowserConcurrency)}</td><td>${formatDuration(summary.wallTimeMs)}</td><td>${browserRunSpeedup(summary, browserRunBaseline)}</td><td>${summary.passed}/${summary.failed}</td></tr>`;
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
  <p>${summary.scenarioCount} scenarios, ${formatCount(summary.browserSessionCount)} browser sessions, configured capacity ${formatCount(summary.configuredCapacity)}, observed overlap ${summary.maxConcurrency}, max/browser ${formatCount(summary.maxPerBrowserConcurrency)}, wall time ${formatDuration(summary.wallTimeMs)}.</p>
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

function formatDuration(ms) {
	if (!ms) {
		return '0s';
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
		console.log(`${summary.mode}: ${summary.scenarioCount} scenarios, ${formatCount(summary.browserSessionCount)} browser sessions, configured capacity ${formatCount(summary.configuredCapacity)}, observed overlap ${summary.maxConcurrency}, max/browser ${formatCount(summary.maxPerBrowserConcurrency)}, wall time ${formatDuration(summary.wallTimeMs)}, Browser Run speedup ${browserRunSpeedup(summary, browserRunBaseline)}`);
	}
}

function cliModes() {
	return process.argv.slice(2).filter((arg) => arg !== '--');
}
