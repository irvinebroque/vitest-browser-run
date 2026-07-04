import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-owner-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-owner-en-us-mobile');
	});
});
