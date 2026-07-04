import { scenarioManifest } from './scenario-manifest';
import type { Scenario, ScenarioBootstrap, ScenarioLocale, ScenarioRole, ScenarioSurface } from './scenario-types';

export { scenarioManifest } from './scenario-manifest';
export type { Scenario, ScenarioBootstrap } from './scenario-types';

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
		formattedRevenue: formatScenarioCurrency(128_450 + scenario.id.length * 137, scenario.locale),
		primaryAction: roleActions[scenario.role],
		guardrail: roleGuardrails[scenario.role],
		navigation: navigationBySurface[scenario.surface],
	};
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
    </section>
    <nav aria-label="Scenario navigation"><ul>${navigation}</ul></nav>
  </main>
</body>
</html>`;
}

export function scenarioRoute(id: string): string {
	return `/app/scenario/${encodeURIComponent(id)}`;
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
