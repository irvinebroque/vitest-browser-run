import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-owner-ar-eg-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-owner-ar-eg-mobile');
	});
});
