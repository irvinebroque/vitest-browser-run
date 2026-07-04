import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-billing-ar-eg-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-billing-ar-eg-desktop');
	});
});
