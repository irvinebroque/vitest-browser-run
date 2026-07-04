import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-admin-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-admin-en-us-mobile');
	});
});
