import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-billing-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-billing-fr-fr-mobile');
	});
});
