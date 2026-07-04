import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const surfaces = ['dashboard', 'billing', 'checkout', 'admin', 'settings', 'audit-log'];
const roles = ['owner', 'admin', 'billing', 'viewer'];
const locales = ['en-US', 'fr-FR', 'ja-JP', 'ar-EG'];
const viewports = ['desktop', 'mobile'];
const plans = ['free', 'pro', 'enterprise'];
const regions = ['na', 'eu', 'apac', 'mea'];
const dataSizes = ['empty', 'standard', 'large'];
const featureStates = ['control', 'rollout', 'beta'];

const profiles = {
	default: { legacy: true },
	full: { count: 192 },
	large: { count: 384 },
	xlarge: { count: 768 },
	stress: { count: 1536 },
};

const flagSets = {
	dashboard: ['new-nav', 'usage-alerts'],
	billing: ['invoice-redesign', 'tax-preview'],
	checkout: ['express-checkout', 'fraud-review'],
	admin: ['rbac-v2', 'policy-audit'],
	settings: ['integrations-hub', 'security-center'],
	'audit-log': ['streaming-export', 'retention-controls'],
};

const profile = process.env.BENCHMARK_SCENARIO_PROFILE ?? process.env.BENCHMARK_PROFILE ?? 'default';
const scenarioCount = readScenarioCount();
const scenarios = createScenarios(profile, scenarioCount);

await writeScenarioManifest();
await writeScenarioTests();

console.log(`Generated ${scenarios.length} benchmark scenarios for profile "${profile}".`);

function readScenarioCount() {
	if (!process.env.BENCHMARK_SCENARIO_COUNT) {
		return undefined;
	}

	const count = Number(process.env.BENCHMARK_SCENARIO_COUNT);
	if (!Number.isInteger(count) || count < 1) {
		throw new Error(`Invalid BENCHMARK_SCENARIO_COUNT: expected a positive integer, got ${JSON.stringify(process.env.BENCHMARK_SCENARIO_COUNT)}.`);
	}

	return count;
}

function createScenarios(profileName, countOverride) {
	const profileConfig = profiles[profileName];
	if (!profileConfig && !countOverride) {
		throw new Error(`Unknown BENCHMARK_PROFILE "${profileName}". Expected one of: ${Object.keys(profiles).join(', ')}.`);
	}

	if (profileConfig?.legacy && !countOverride) {
		return createDefaultScenarios();
	}

	const count = countOverride ?? profileConfig?.count;
	return selectEvenly(createExpandedScenarioMatrix(), count);
}

function createDefaultScenarios() {
	const defaultScenarios = [];

	for (const [surfaceIndex, surface] of surfaces.entries()) {
		for (const [roleIndex, role] of roles.entries()) {
			for (const [localeIndex, locale] of locales.entries()) {
				for (const [viewportIndex, viewport] of viewports.entries()) {
					if ((surfaceIndex + roleIndex + localeIndex + viewportIndex) % 2 !== 0) {
						continue;
					}

					defaultScenarios.push({
						id: [surface, role, locale.toLowerCase(), viewport].join('-'),
						surface,
						role,
						locale,
						viewport,
						flags: flagSets[surface],
					});
				}
			}
		}
	}

	return defaultScenarios;
}

function createExpandedScenarioMatrix() {
	const matrix = [];

	for (const surface of surfaces) {
		for (const role of roles) {
			for (const locale of locales) {
				for (const viewport of viewports) {
					for (const plan of plans) {
						for (const region of regions) {
							for (const dataSize of dataSizes) {
								for (const featureState of featureStates) {
									matrix.push({
										dataSize,
										featureState,
										flags: [...flagSets[surface], `${plan}-plan`, `${featureState}-state`],
										id: [surface, role, locale.toLowerCase(), viewport, plan, region, dataSize, featureState].join('-'),
										locale,
										plan,
										region,
										role,
										surface,
										viewport,
									});
								}
							}
						}
					}
				}
			}
		}
	}

	return matrix;
}

function selectEvenly(items, count) {
	if (!count || count >= items.length) {
		return items;
	}

	const selected = [];
	const step = items.length / count;
	for (let index = 0; index < count; index += 1) {
		selected.push(items[Math.floor(index * step)]);
	}

	return selected;
}

async function writeScenarioManifest() {
	const content = `import type { Scenario } from './scenario-types';

export const scenarioManifest = ${JSON.stringify(scenarios, null, '\t')} as const satisfies readonly Scenario[];
`;

	await writeFile(join(root, 'src/scenario-manifest.ts'), content);
}

async function writeScenarioTests() {
	const scenarioDir = join(root, 'test/browser/scenarios');
	await rm(scenarioDir, { force: true, recursive: true });
	await mkdir(scenarioDir, { recursive: true });

	await Promise.all(scenarios.map((scenario) => {
		const content = `import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: ${scenario.id}', () => {
\tit('validates the configured app surface', async () => {
\t\tawait runProductionScenario('${scenario.id}');
\t});
});
`;

		return writeFile(join(scenarioDir, `${scenario.id}.browser.test.ts`), content);
	}));
}
