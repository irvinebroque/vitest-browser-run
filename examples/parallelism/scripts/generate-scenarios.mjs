import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const surfaces = ['dashboard', 'billing', 'checkout', 'admin', 'settings', 'audit-log'];
const roles = ['owner', 'admin', 'billing', 'viewer'];
const locales = ['en-US', 'fr-FR', 'ja-JP', 'ar-EG'];
const viewports = ['desktop', 'mobile'];

const flagSets = {
	dashboard: ['new-nav', 'usage-alerts'],
	billing: ['invoice-redesign', 'tax-preview'],
	checkout: ['express-checkout', 'fraud-review'],
	admin: ['rbac-v2', 'policy-audit'],
	settings: ['integrations-hub', 'security-center'],
	'audit-log': ['streaming-export', 'retention-controls'],
};

const scenarios = [];

for (const [surfaceIndex, surface] of surfaces.entries()) {
	for (const [roleIndex, role] of roles.entries()) {
		for (const [localeIndex, locale] of locales.entries()) {
			for (const [viewportIndex, viewport] of viewports.entries()) {
				if ((surfaceIndex + roleIndex + localeIndex + viewportIndex) % 2 !== 0) {
					continue;
				}

				scenarios.push({
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

await writeScenarioManifest();
await writeScenarioTests();

console.log(`Generated ${scenarios.length} benchmark scenarios.`);

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
