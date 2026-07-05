import { expect } from 'vitest';
import { server } from 'vitest/browser';

import {
	createScenarioBootstrap,
	formatScenarioCurrency,
	getScenario,
	loadScenarioApp,
	scenarioDataSize,
	scenarioFeatureState,
	scenarioPlan,
	scenarioRegion,
	scenarioRevenue,
	type Scenario,
	type ScenarioAppData,
	type ScenarioBootstrap,
} from '../../src/scenarios';

type ScenarioStatus = 'passed' | 'failed';

interface BrowserRunPoolMetadata {
	browserLeaseId?: number;
	browserLeaseIndex?: number;
	browserRunSessionId?: string;
	maxBrowsers?: number;
	sessionId?: string;
	sessionsPerBrowser?: number | null;
}

export async function runProductionScenario(id: string): Promise<void> {
	const scenario = getScenario(id);
	const bootstrap = createScenarioBootstrap(id);
	const mode = readMetaEnv('VITEST_BENCHMARK_MODE', 'ad-hoc');
	const appLatencyMs = readNumberMetaEnv('BENCHMARK_APP_LATENCY_MS', 1000);
	const startedAt = Date.now();
	let appData: ScenarioAppData | undefined;
	let status: ScenarioStatus = 'passed';
	let errorMessage = '';

	try {
		renderLoadingShell(bootstrap);
		appData = await loadScenarioApp(bootstrap, { baseLatencyMs: appLatencyMs });
		renderReadyShell(bootstrap, appData);
		await waitForScenarioReady(scenario.id);
		assertScenarioState(scenario, bootstrap, appData);
	}
	catch (error) {
		status = 'failed';
		errorMessage = error instanceof Error ? error.message : String(error);
		throw error;
	}
	finally {
		await writeBenchmarkEvent({
			appData,
			browserRunPool: readBrowserRunPoolMetadata(),
			durationMs: Date.now() - startedAt,
			endTime: Date.now(),
			errorMessage,
			mode,
			scenario,
			startTime: startedAt,
			status,
			workerId: readMetaEnv('VITEST_WORKER_ID', 'unknown'),
		});
	}
}

function renderLoadingShell(bootstrap: ScenarioBootstrap): void {
	document.body.innerHTML = `
		<main data-testid="scenario-root" data-state="loading" data-scenario="${bootstrap.scenario.id}">
			<p data-testid="scenario-worker">Vitest worker ${readMetaEnv('VITEST_WORKER_ID', 'unknown')}</p>
			<h1>${bootstrap.title}</h1>
			<p data-testid="scenario-status">Loading ${bootstrap.scenario.surface} data for ${bootstrap.scenario.role}</p>
		</main>
	`;
}

function renderReadyShell(bootstrap: ScenarioBootstrap, appData: ScenarioAppData): void {
	const { scenario } = bootstrap;
	document.body.dataset.viewport = scenario.viewport;
	document.documentElement.lang = scenario.locale;
	document.body.innerHTML = `
		<main data-testid="scenario-root" data-state="ready" data-scenario="${scenario.id}" data-surface="${scenario.surface}" data-role="${scenario.role}" data-plan="${scenarioPlan(scenario)}" data-region="${scenarioRegion(scenario)}" data-size="${scenarioDataSize(scenario)}" data-feature-state="${scenarioFeatureState(scenario)}">
			<p data-testid="scenario-worker">Vitest worker ${readMetaEnv('VITEST_WORKER_ID', 'unknown')}</p>
			<h1>${bootstrap.title}</h1>
			<p data-testid="scenario-status">Ready</p>
			<p data-testid="scenario-locale">${scenario.locale}</p>
			<p data-testid="scenario-viewport">${scenario.viewport}</p>
			<p data-testid="scenario-plan">${bootstrap.planLabel}</p>
			<p data-testid="scenario-region">${bootstrap.regionLabel}</p>
			<p data-testid="scenario-scale">${bootstrap.scaleLabel}</p>
			<p data-testid="scenario-feature-state">${bootstrap.stateLabel}</p>
			<p data-testid="scenario-action">${bootstrap.primaryAction}</p>
			<p data-testid="scenario-guardrail">${bootstrap.guardrail}</p>
			<p data-testid="scenario-revenue">${bootstrap.formattedRevenue}</p>
			<p data-testid="scenario-records">${appData.recordsLoaded}</p>
			<p data-testid="scenario-app-latency">${appData.appLatencyMs}</p>
			<p data-testid="scenario-summary">${appData.summary}</p>
			<ol data-testid="scenario-load-phases">
				${appData.phaseLabels.map((phase) => `<li>${phase}</li>`).join('')}
			</ol>
			<nav aria-label="Scenario navigation">
				${bootstrap.navigation.map((item) => `<a href="#${item.toLowerCase().replaceAll(' ', '-')}">${item}</a>`).join('')}
			</nav>
			<ul data-testid="scenario-flags">
				${scenario.flags.map((flag) => `<li>${flag}</li>`).join('')}
			</ul>
		</main>
	`;
}

async function waitForScenarioReady(id: string): Promise<void> {
	const startedAt = performance.now();
	while (performance.now() - startedAt < 1000) {
		const root = document.querySelector<HTMLElement>('[data-testid="scenario-root"]');
		if (root?.dataset.state === 'ready' && root.dataset.scenario === id) {
			return;
		}

		await wait(25);
	}

	throw new Error(`Timed out waiting for scenario ${id} to become ready.`);
}

function assertScenarioState(scenario: Scenario, bootstrap: ScenarioBootstrap, appData: ScenarioAppData): void {
	const root = getByTestId('scenario-root');
	expect(root.dataset.state).toBe('ready');
	expect(root.dataset.scenario).toBe(scenario.id);
	expect(root.dataset.surface).toBe(scenario.surface);
	expect(root.dataset.role).toBe(scenario.role);
	expect(root.dataset.plan).toBe(scenarioPlan(scenario));
	expect(root.dataset.region).toBe(scenarioRegion(scenario));
	expect(root.dataset.size).toBe(scenarioDataSize(scenario));
	expect(root.dataset.featureState).toBe(scenarioFeatureState(scenario));
	expect(getByTestId('scenario-locale').textContent).toBe(scenario.locale);
	expect(getByTestId('scenario-viewport').textContent).toBe(scenario.viewport);
	expect(getByTestId('scenario-plan').textContent).toBe(bootstrap.planLabel);
	expect(getByTestId('scenario-region').textContent).toBe(bootstrap.regionLabel);
	expect(getByTestId('scenario-scale').textContent).toBe(bootstrap.scaleLabel);
	expect(getByTestId('scenario-feature-state').textContent).toBe(bootstrap.stateLabel);
	expect(getByTestId('scenario-action').textContent).toBe(bootstrap.primaryAction);
	expect(getByTestId('scenario-guardrail').textContent).toBe(bootstrap.guardrail);
	expect(getByTestId('scenario-revenue').textContent).toBe(formatScenarioCurrency(scenarioRevenue(scenario), scenario.locale));
	expect(getByTestId('scenario-records').textContent).toBe(String(appData.recordsLoaded));
	expect(getByTestId('scenario-app-latency').textContent).toBe(String(appData.appLatencyMs));
	expect(getByTestId('scenario-summary').textContent).toBe(appData.summary);
	for (const phase of appData.phaseLabels) {
		expect(getByTestId('scenario-load-phases').textContent).toContain(phase);
	}
	for (const flag of scenario.flags) {
		expect(getByTestId('scenario-flags').textContent).toContain(flag);
	}
}

async function writeBenchmarkEvent(event: {
	appData: ScenarioAppData | undefined;
	browserRunPool: BrowserRunPoolMetadata;
	durationMs: number;
	endTime: number;
	errorMessage: string;
	mode: string;
	scenario: Scenario;
	startTime: number;
	status: ScenarioStatus;
	workerId: string;
}): Promise<void> {
	const path = `artifacts/benchmark/${event.mode}/events/${event.scenario.id}.json`;
	await server.commands.writeFile(path, `${JSON.stringify({
		appLatencyMs: event.appData?.appLatencyMs ?? null,
		benchmarkConcurrency: readNumberMetaEnv('BENCHMARK_CONCURRENCY', 0) || null,
		browserLeaseId: event.browserRunPool.browserLeaseId ?? null,
		browserLeaseIndex: event.browserRunPool.browserLeaseIndex ?? null,
		browserRunSessionId: event.browserRunPool.browserRunSessionId ?? null,
		dataSize: event.scenario.dataSize ?? null,
		durationMs: event.durationMs,
		endTime: event.endTime,
		errorMessage: event.errorMessage,
		featureState: event.scenario.featureState ?? null,
		flags: event.scenario.flags,
		locale: event.scenario.locale,
		maxBrowsers: event.browserRunPool.maxBrowsers ?? null,
		mode: event.mode,
		provider: server.provider,
		region: event.scenario.region ?? null,
		plan: event.scenario.plan ?? null,
		role: event.scenario.role,
		scenarioId: event.scenario.id,
		sessionId: event.browserRunPool.sessionId ?? null,
		sessionsPerBrowser: event.browserRunPool.sessionsPerBrowser ?? null,
		startTime: event.startTime,
		status: event.status,
		surface: event.scenario.surface,
		viewport: event.scenario.viewport,
		workerId: event.workerId,
	})}\n`);
}

function readBrowserRunPoolMetadata(): BrowserRunPoolMetadata {
	const current = readBrowserRunPoolMetadataFrom(globalThis);
	if (current) {
		return current;
	}

	try {
		if (globalThis.parent && globalThis.parent !== globalThis) {
			return readBrowserRunPoolMetadataFrom(globalThis.parent) ?? {};
		}
	}
	catch {
		return {};
	}

	return {};
}

function readBrowserRunPoolMetadataFrom(scope: Window | typeof globalThis): BrowserRunPoolMetadata | undefined {
	return (scope as typeof globalThis & { __CLOUDFLARE_BROWSER_RUN_POOL__?: BrowserRunPoolMetadata }).__CLOUDFLARE_BROWSER_RUN_POOL__;
}

function getByTestId(testId: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
	expect(element).not.toBeNull();
	return element!;
}

function readMetaEnv(name: string, fallback: string): string {
	const config = server.config as typeof server.config & { env?: Record<string, string | undefined> };
	if (config.env?.[name]) {
		return config.env[name];
	}

	const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
	return meta.env?.[name] ?? fallback;
}

function readNumberMetaEnv(name: string, fallback: number): number {
	const value = Number(readMetaEnv(name, String(fallback)));
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
