import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-billing-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-billing-fr-fr-mobile');
	});
});
