import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-admin-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-admin-en-us-mobile');
	});
});
