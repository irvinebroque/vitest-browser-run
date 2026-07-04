import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-admin-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-admin-en-us-desktop');
	});
});
