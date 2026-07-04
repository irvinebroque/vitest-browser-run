import { expect } from 'vitest';
import { server } from 'vitest/browser';

import { createScenarioBootstrap, formatScenarioCurrency, getScenario, type Scenario, type ScenarioBootstrap } from '../../src/scenarios';

type ScenarioStatus = 'passed' | 'failed';

export async function runProductionScenario(id: string): Promise<void> {
	const scenario = getScenario(id);
	const bootstrap = createScenarioBootstrap(id);
	const mode = readMetaEnv('VITEST_BENCHMARK_MODE', 'ad-hoc');
	const delayMs = readNumberMetaEnv('VITEST_SCENARIO_DELAY_MS', 2200);
	const startedAt = Date.now();
	let status: ScenarioStatus = 'passed';
	let errorMessage = '';

	try {
		renderLoadingShell(bootstrap);
		await delay(delayMs / 2);
		renderReadyShell(bootstrap);
		await delay(delayMs / 2);
		assertScenarioState(scenario, bootstrap);
	}
	catch (error) {
		status = 'failed';
		errorMessage = error instanceof Error ? error.message : String(error);
		throw error;
	}
	finally {
		await writeBenchmarkEvent({
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
			<p data-testid="scenario-status">Loading ${bootstrap.scenario.surface} for ${bootstrap.scenario.role}</p>
		</main>
	`;
}

function renderReadyShell(bootstrap: ScenarioBootstrap): void {
	const { scenario } = bootstrap;
	document.body.dataset.viewport = scenario.viewport;
	document.documentElement.lang = scenario.locale;
	document.body.innerHTML = `
		<main data-testid="scenario-root" data-state="ready" data-scenario="${scenario.id}" data-surface="${scenario.surface}" data-role="${scenario.role}">
			<p data-testid="scenario-worker">Vitest worker ${readMetaEnv('VITEST_WORKER_ID', 'unknown')}</p>
			<h1>${bootstrap.title}</h1>
			<p data-testid="scenario-status">Ready</p>
			<p data-testid="scenario-locale">${scenario.locale}</p>
			<p data-testid="scenario-viewport">${scenario.viewport}</p>
			<p data-testid="scenario-action">${bootstrap.primaryAction}</p>
			<p data-testid="scenario-guardrail">${bootstrap.guardrail}</p>
			<p data-testid="scenario-revenue">${bootstrap.formattedRevenue}</p>
			<nav aria-label="Scenario navigation">
				${bootstrap.navigation.map((item) => `<a href="#${item.toLowerCase().replaceAll(' ', '-')}">${item}</a>`).join('')}
			</nav>
			<ul data-testid="scenario-flags">
				${scenario.flags.map((flag) => `<li>${flag}</li>`).join('')}
			</ul>
		</main>
	`;
}

function assertScenarioState(scenario: Scenario, bootstrap: ScenarioBootstrap): void {
	const root = getByTestId('scenario-root');
	expect(root.dataset.state).toBe('ready');
	expect(root.dataset.scenario).toBe(scenario.id);
	expect(root.dataset.surface).toBe(scenario.surface);
	expect(root.dataset.role).toBe(scenario.role);
	expect(getByTestId('scenario-locale').textContent).toBe(scenario.locale);
	expect(getByTestId('scenario-viewport').textContent).toBe(scenario.viewport);
	expect(getByTestId('scenario-action').textContent).toBe(bootstrap.primaryAction);
	expect(getByTestId('scenario-guardrail').textContent).toBe(bootstrap.guardrail);
	expect(getByTestId('scenario-revenue').textContent).toBe(formatScenarioCurrency(128_450 + scenario.id.length * 137, scenario.locale));
	for (const flag of scenario.flags) {
		expect(getByTestId('scenario-flags').textContent).toContain(flag);
	}
}

async function writeBenchmarkEvent(event: {
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
		durationMs: event.durationMs,
		endTime: event.endTime,
		errorMessage: event.errorMessage,
		flags: event.scenario.flags,
		locale: event.scenario.locale,
		mode: event.mode,
		provider: server.provider,
		role: event.scenario.role,
		scenarioId: event.scenario.id,
		startTime: event.startTime,
		status: event.status,
		surface: event.scenario.surface,
		viewport: event.scenario.viewport,
		workerId: event.workerId,
	})}\n`);
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
