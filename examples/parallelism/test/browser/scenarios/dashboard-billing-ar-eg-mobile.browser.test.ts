import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-billing-ar-eg-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-billing-ar-eg-mobile');
	});
});
