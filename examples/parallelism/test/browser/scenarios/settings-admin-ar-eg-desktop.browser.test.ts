import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-admin-ar-eg-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-admin-ar-eg-desktop');
	});
});
