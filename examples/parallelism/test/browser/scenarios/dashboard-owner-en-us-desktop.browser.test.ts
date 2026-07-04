import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-owner-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-owner-en-us-desktop');
	});
});
