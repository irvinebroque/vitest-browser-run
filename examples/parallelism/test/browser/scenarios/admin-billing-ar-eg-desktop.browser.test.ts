import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-billing-ar-eg-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-billing-ar-eg-desktop');
	});
});
