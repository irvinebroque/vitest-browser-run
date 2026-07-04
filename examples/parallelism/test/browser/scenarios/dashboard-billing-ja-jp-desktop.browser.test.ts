import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-billing-ja-jp-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-billing-ja-jp-desktop');
	});
});
