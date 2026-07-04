import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-admin-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-admin-fr-fr-mobile');
	});
});
