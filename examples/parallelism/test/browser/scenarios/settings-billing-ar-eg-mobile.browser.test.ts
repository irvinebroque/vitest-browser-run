import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-billing-ar-eg-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-billing-ar-eg-mobile');
	});
});
