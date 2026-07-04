import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-admin-ja-jp-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-admin-ja-jp-mobile');
	});
});
