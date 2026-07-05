import { scenarioManifest } from './scenario-manifest';
import type {
	Scenario,
	ScenarioAppData,
	ScenarioAppLoadPhase,
	ScenarioBootstrap,
	ScenarioDataSize,
	ScenarioFeatureState,
	ScenarioLocale,
	ScenarioPlan,
	ScenarioRegion,
	ScenarioRole,
	ScenarioSurface,
} from './scenario-types';

export { scenarioManifest } from './scenario-manifest';
export type { Scenario, ScenarioAppData, ScenarioBootstrap } from './scenario-types';

const surfaceLabels = {
	dashboard: 'Executive dashboard',
	billing: 'Billing center',
	checkout: 'Checkout flow',
	admin: 'Admin console',
	settings: 'Workspace settings',
	'audit-log': 'Audit log',
} satisfies Record<ScenarioSurface, string>;

const roleActions = {
	owner: 'Approve organization-wide changes',
	admin: 'Manage workspace settings',
	billing: 'Review invoice and payment method',
	viewer: 'Inspect read-only production state',
} satisfies Record<ScenarioRole, string>;

const roleGuardrails = {
	owner: 'Owner can access all critical controls',
	admin: 'Admin sees operational controls but not ownership transfer',
	billing: 'Billing role is scoped to invoices, plans, and payment methods',
	viewer: 'Viewer cannot mutate customer data',
} satisfies Record<ScenarioRole, string>;

const navigationBySurface = {
	dashboard: ['Revenue', 'Usage', 'Health'],
	billing: ['Plan', 'Invoices', 'Payment methods'],
	checkout: ['Cart', 'Tax', 'Confirmation'],
	admin: ['Members', 'Roles', 'Policies'],
	settings: ['Profile', 'Security', 'Integrations'],
	'audit-log': ['Events', 'Exports', 'Retention'],
} satisfies Record<ScenarioSurface, string[]>;

const planLabels = {
	free: 'Free plan',
	pro: 'Pro plan',
	enterprise: 'Enterprise plan',
} satisfies Record<ScenarioPlan, string>;

const regionLabels = {
	na: 'North America',
	eu: 'Europe',
	apac: 'Asia Pacific',
	mea: 'Middle East and Africa',
} satisfies Record<ScenarioRegion, string>;

const dataSizeLabels = {
	empty: 'Empty account',
	standard: 'Standard account',
	large: 'Large account',
} satisfies Record<ScenarioDataSize, string>;

const featureStateLabels = {
	control: 'Control cohort',
	rollout: 'Rollout cohort',
	beta: 'Beta cohort',
} satisfies Record<ScenarioFeatureState, string>;

export function getScenario(id: string): Scenario {
	const scenario = scenarioManifest.find((item) => item.id === id);
	if (!scenario) {
		throw new Error(`Unknown benchmark scenario: ${id}`);
	}

	return scenario;
}

export function createScenarioBootstrap(id: string): ScenarioBootstrap {
	const scenario = getScenario(id);
	return {
		scenario,
		title: `${surfaceLabels[scenario.surface]} for ${scenario.role}`,
		formattedRevenue: formatScenarioCurrency(scenarioRevenue(scenario), scenario.locale),
		primaryAction: roleActions[scenario.role],
		guardrail: roleGuardrails[scenario.role],
		navigation: navigationBySurface[scenario.surface],
		planLabel: planLabels[scenarioPlan(scenario)],
		regionLabel: regionLabels[scenarioRegion(scenario)],
		scaleLabel: dataSizeLabels[scenarioDataSize(scenario)],
		stateLabel: featureStateLabels[scenarioFeatureState(scenario)],
	};
}

export async function loadScenarioApp(bootstrap: ScenarioBootstrap, options: { baseLatencyMs?: number } = {}): Promise<ScenarioAppData> {
	const latencyMs = scenarioAppLatencyMs(bootstrap.scenario, options.baseLatencyMs ?? 1000);
	const phases = scenarioAppLoadPhases(bootstrap, latencyMs);

	for (const phase of phases) {
		await wait(phase.durationMs);
	}

	const recordsLoaded = scenarioRecordCount(bootstrap.scenario);
	return {
		appLatencyMs: latencyMs,
		phaseLabels: phases.map((phase) => phase.label),
		recordsLoaded,
		summary: `${bootstrap.title} loaded ${recordsLoaded.toLocaleString('en-US')} records for ${bootstrap.regionLabel}`,
	};
}

export function scenarioAppLatencyMs(scenario: Scenario, baseLatencyMs = 1000): number {
	if (baseLatencyMs <= 0) {
		return 0;
	}

	const multiplier = clamp(
		surfaceLatencyWeight[scenario.surface]
		* planLatencyWeight[scenarioPlan(scenario)]
		* regionLatencyWeight[scenarioRegion(scenario)]
		* dataLatencyWeight[scenarioDataSize(scenario)]
		* featureLatencyWeight[scenarioFeatureState(scenario)]
		* scenarioLatencyJitter(scenario),
		0.55,
		1.75,
	);

	return Math.max(150, Math.round(baseLatencyMs * multiplier));
}

export function scenarioAppLoadPhases(bootstrap: ScenarioBootstrap, latencyMs: number): ScenarioAppLoadPhase[] {
	const authDurationMs = Math.round(latencyMs * 0.2);
	const dataDurationMs = Math.round(latencyMs * 0.55);
	return [
		{ durationMs: authDurationMs, label: `Authenticate ${bootstrap.scenario.role} session` },
		{ durationMs: dataDurationMs, label: `Fetch ${bootstrap.scaleLabel.toLowerCase()} ${bootstrap.scenario.surface} data` },
		{ durationMs: Math.max(0, latencyMs - authDurationMs - dataDurationMs), label: `Resolve ${bootstrap.stateLabel.toLowerCase()} flags` },
	];
}

export function scenarioAppHtml(id: string): string {
	const bootstrap = createScenarioBootstrap(id);
	const { scenario } = bootstrap;
	const flags = scenario.flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('');
	const navigation = bootstrap.navigation.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

	return `<!doctype html>
<html lang="${escapeHtml(scenario.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(bootstrap.title)} - Browser Run benchmark</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #020617; color: #f8fafc; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #1d4ed8 0, transparent 28rem), #020617; }
    main { width: min(64rem, calc(100vw - 2rem)); margin: 2rem auto; padding: 2rem; border: 1px solid #1e293b; border-radius: 1.5rem; background: rgba(15, 23, 42, 0.94); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42); }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
    .card { padding: 1rem; border: 1px solid #334155; border-radius: 1rem; background: rgba(2, 6, 23, 0.7); }
    [data-viewport="mobile"] .grid { grid-template-columns: 1fr; }
    strong { color: #93c5fd; }
  </style>
</head>
<body data-viewport="${scenario.viewport}">
  <main data-testid="scenario-root">
    <p><strong>${escapeHtml(scenario.id)}</strong></p>
    <h1>${escapeHtml(bootstrap.title)}</h1>
    <p data-testid="scenario-guardrail">${escapeHtml(bootstrap.guardrail)}</p>
     <section class="grid">
       <article class="card"><h2>Primary action</h2><p data-testid="scenario-action">${escapeHtml(bootstrap.primaryAction)}</p></article>
       <article class="card"><h2>Revenue</h2><p data-testid="scenario-revenue">${escapeHtml(bootstrap.formattedRevenue)}</p></article>
       <article class="card"><h2>Flags</h2><ul data-testid="scenario-flags">${flags}</ul></article>
       <article class="card"><h2>Plan</h2><p>${escapeHtml(bootstrap.planLabel)}</p></article>
       <article class="card"><h2>Region</h2><p>${escapeHtml(bootstrap.regionLabel)}</p></article>
       <article class="card"><h2>Scale</h2><p>${escapeHtml(bootstrap.scaleLabel)}</p></article>
     </section>
     <p>${escapeHtml(bootstrap.stateLabel)}</p>
     <nav aria-label="Scenario navigation"><ul>${navigation}</ul></nav>
   </main>
</body>
</html>`;
}

export function scenarioRoute(id: string): string {
	return `/app/scenario/${encodeURIComponent(id)}`;
}

export function scenarioRevenue(scenario: Scenario): number {
	const planMultiplier = scenarioPlan(scenario) === 'enterprise' ? 8 : scenarioPlan(scenario) === 'pro' ? 3 : 1;
	const dataMultiplier = scenarioDataSize(scenario) === 'large' ? 5 : scenarioDataSize(scenario) === 'standard' ? 2 : 1;
	return 64_000 + scenario.id.length * 137 * planMultiplier * dataMultiplier;
}

export function scenarioRecordCount(scenario: Scenario): number {
	const baseRecords = scenarioDataSize(scenario) === 'large' ? 2400 : scenarioDataSize(scenario) === 'standard' ? 320 : 12;
	const surfaceMultiplier = scenario.surface === 'audit-log' ? 4 : scenario.surface === 'checkout' ? 2 : 1;
	const planMultiplier = scenarioPlan(scenario) === 'enterprise' ? 3 : scenarioPlan(scenario) === 'pro' ? 2 : 1;
	return baseRecords * surfaceMultiplier * planMultiplier + scenario.id.length;
}

export function scenarioPlan(scenario: Scenario): ScenarioPlan {
	return scenario.plan ?? 'pro';
}

export function scenarioRegion(scenario: Scenario): ScenarioRegion {
	return scenario.region ?? 'na';
}

export function scenarioDataSize(scenario: Scenario): ScenarioDataSize {
	return scenario.dataSize ?? 'standard';
}

export function scenarioFeatureState(scenario: Scenario): ScenarioFeatureState {
	return scenario.featureState ?? 'control';
}

export function formatScenarioCurrency(value: number, locale: ScenarioLocale): string {
	const currency = locale === 'ja-JP' ? 'JPY' : locale === 'ar-EG' ? 'EGP' : locale === 'fr-FR' ? 'EUR' : 'USD';
	return new Intl.NumberFormat(locale, { currency, maximumFractionDigits: 0, style: 'currency' }).format(value);
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
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

const surfaceLatencyWeight = {
	dashboard: 1.02,
	billing: 1.08,
	checkout: 1.14,
	admin: 1.1,
	settings: 0.92,
	'audit-log': 1.18,
} satisfies Record<ScenarioSurface, number>;

const planLatencyWeight = {
	free: 0.9,
	pro: 1,
	enterprise: 1.14,
} satisfies Record<ScenarioPlan, number>;

const regionLatencyWeight = {
	na: 0.96,
	eu: 1,
	apac: 1.08,
	mea: 1.12,
} satisfies Record<ScenarioRegion, number>;

const dataLatencyWeight = {
	empty: 0.74,
	standard: 1,
	large: 1.34,
} satisfies Record<ScenarioDataSize, number>;

const featureLatencyWeight = {
	control: 0.94,
	rollout: 1.04,
	beta: 1.12,
} satisfies Record<ScenarioFeatureState, number>;

function scenarioLatencyJitter(scenario: Scenario): number {
	let hash = 0;
	for (const character of scenario.id) {
		hash = (hash * 31 + character.charCodeAt(0)) % 997;
	}

	return 0.94 + (hash % 13) / 100;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

async function wait(ms: number): Promise<void> {
	if (ms <= 0) {
		return;
	}

	await new Promise((resolve) => setTimeout(resolve, ms));
}
