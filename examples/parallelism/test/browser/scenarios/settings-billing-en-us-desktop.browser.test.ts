import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-billing-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-billing-en-us-desktop');
	});
});
