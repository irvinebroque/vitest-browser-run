import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-admin-ja-jp-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-admin-ja-jp-mobile');
	});
});
