import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-owner-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-owner-fr-fr-mobile');
	});
});
