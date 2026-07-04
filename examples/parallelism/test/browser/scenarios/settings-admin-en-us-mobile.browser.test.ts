import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-admin-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-admin-en-us-mobile');
	});
});
