import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-billing-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-billing-fr-fr-desktop');
	});
});
