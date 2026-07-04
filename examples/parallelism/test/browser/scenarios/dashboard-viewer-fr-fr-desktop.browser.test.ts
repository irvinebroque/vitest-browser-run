import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-viewer-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-viewer-fr-fr-desktop');
	});
});
