import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-owner-ja-jp-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-owner-ja-jp-desktop');
	});
});
