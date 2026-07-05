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
	scenarioRoute,
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
	const startedAt = Date.now();
	const expectedAppData = loadScenarioApp(bootstrap);
	let appData: ScenarioAppData | undefined;
	let status: ScenarioStatus = 'passed';
	let errorMessage = '';

	try {
		const appDocument = await navigateToScenarioApp(scenarioRoute(id), scenario.id);
		appData = expectedAppData;
		assertScenarioState(appDocument, scenario, bootstrap, appData);
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

async function navigateToScenarioApp(route: string, id: string): Promise<Document> {
	const iframe = document.createElement('iframe');
	iframe.dataset.testid = 'scenario-app-frame';
	iframe.style.border = '0';
	iframe.style.height = '800px';
	iframe.style.width = '1280px';

	const loaded = new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`Timed out loading scenario route ${route}.`)), 30000);
		iframe.addEventListener('load', () => {
			clearTimeout(timeout);
			resolve();
		}, { once: true });
		iframe.addEventListener('error', () => {
			clearTimeout(timeout);
			reject(new Error(`Failed to load scenario route ${route}.`));
		}, { once: true });
	});

	iframe.src = route;
	document.body.replaceChildren(iframe);
	await loaded;

	const appDocument = iframe.contentDocument;
	if (!appDocument) {
		throw new Error(`Unable to read scenario route ${route}.`);
	}

	await waitForScenarioReady(appDocument, id);
	return appDocument;
}

async function waitForScenarioReady(appDocument: Document, id: string): Promise<void> {
	const startedAt = performance.now();
	while (performance.now() - startedAt < 1000) {
		const root = appDocument.querySelector<HTMLElement>('[data-testid="scenario-root"]');
		if (root?.dataset.state === 'ready' && root.dataset.scenario === id) {
			return;
		}

		await delay(25);
	}

	throw new Error(`Timed out waiting for scenario ${id} to become ready.`);
}

function assertScenarioState(appDocument: Document, scenario: Scenario, bootstrap: ScenarioBootstrap, appData: ScenarioAppData): void {
	const root = getByTestId(appDocument, 'scenario-root');
	expect(root.dataset.state).toBe('ready');
	expect(root.dataset.scenario).toBe(scenario.id);
	expect(root.dataset.surface).toBe(scenario.surface);
	expect(root.dataset.role).toBe(scenario.role);
	expect(root.dataset.plan).toBe(scenarioPlan(scenario));
	expect(root.dataset.region).toBe(scenarioRegion(scenario));
	expect(root.dataset.size).toBe(scenarioDataSize(scenario));
	expect(root.dataset.featureState).toBe(scenarioFeatureState(scenario));
	expect(appDocument.documentElement.lang).toBe(scenario.locale);
	expect(appDocument.body.dataset.viewport).toBe(scenario.viewport);
	expect(getByTestId(appDocument, 'scenario-locale').textContent).toBe(scenario.locale);
	expect(getByTestId(appDocument, 'scenario-viewport').textContent).toBe(scenario.viewport);
	expect(getByTestId(appDocument, 'scenario-plan').textContent).toBe(bootstrap.planLabel);
	expect(getByTestId(appDocument, 'scenario-region').textContent).toBe(bootstrap.regionLabel);
	expect(getByTestId(appDocument, 'scenario-scale').textContent).toBe(bootstrap.scaleLabel);
	expect(getByTestId(appDocument, 'scenario-feature-state').textContent).toBe(bootstrap.stateLabel);
	expect(getByTestId(appDocument, 'scenario-action').textContent).toBe(bootstrap.primaryAction);
	expect(getByTestId(appDocument, 'scenario-guardrail').textContent).toBe(bootstrap.guardrail);
	expect(getByTestId(appDocument, 'scenario-revenue').textContent).toBe(formatScenarioCurrency(scenarioRevenue(scenario), scenario.locale));
	expect(getByTestId(appDocument, 'scenario-records').textContent).toBe(String(appData.recordsLoaded));
	expect(getByTestId(appDocument, 'scenario-summary').textContent).toBe(appData.summary);
	for (const phase of appData.phaseLabels) {
		expect(getByTestId(appDocument, 'scenario-load-phases').textContent).toContain(phase);
	}
	for (const flag of scenario.flags) {
		expect(getByTestId(appDocument, 'scenario-flags').textContent).toContain(flag);
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
		benchmarkSessionsPerBrowser: readNumberMetaEnv('BENCHMARK_SESSIONS_PER_BROWSER', 0) || null,
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

function getByTestId(appDocument: Document, testId: string): HTMLElement {
	const element = appDocument.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
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
