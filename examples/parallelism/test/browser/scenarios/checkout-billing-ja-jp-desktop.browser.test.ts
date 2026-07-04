import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-billing-ja-jp-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-billing-ja-jp-desktop');
	});
});
