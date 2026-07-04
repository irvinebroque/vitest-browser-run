import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-admin-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-admin-fr-fr-desktop');
	});
});
