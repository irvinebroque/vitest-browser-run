import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-owner-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-owner-fr-fr-desktop');
	});
});
