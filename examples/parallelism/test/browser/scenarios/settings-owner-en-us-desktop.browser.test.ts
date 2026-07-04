import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-owner-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-owner-en-us-desktop');
	});
});
