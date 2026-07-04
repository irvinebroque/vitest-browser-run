import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-owner-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-owner-en-us-desktop');
	});
});
