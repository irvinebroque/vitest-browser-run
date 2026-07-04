import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-owner-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-owner-fr-fr-mobile');
	});
});
