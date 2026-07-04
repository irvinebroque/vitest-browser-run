import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-billing-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-billing-fr-fr-desktop');
	});
});
