import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-owner-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-owner-fr-fr-mobile');
	});
});
