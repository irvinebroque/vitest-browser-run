import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: audit-log-billing-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('audit-log-billing-fr-fr-desktop');
	});
});
