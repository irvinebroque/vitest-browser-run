import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-owner-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-owner-fr-fr-desktop');
	});
});
