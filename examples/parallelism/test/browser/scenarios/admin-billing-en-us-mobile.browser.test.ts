import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-billing-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-billing-en-us-mobile');
	});
});
