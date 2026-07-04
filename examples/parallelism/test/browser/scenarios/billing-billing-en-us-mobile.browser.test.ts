import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-billing-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-billing-en-us-mobile');
	});
});
