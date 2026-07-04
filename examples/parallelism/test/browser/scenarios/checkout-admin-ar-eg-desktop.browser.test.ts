import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-admin-ar-eg-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-admin-ar-eg-desktop');
	});
});
