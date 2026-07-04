import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-admin-ja-jp-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-admin-ja-jp-mobile');
	});
});
