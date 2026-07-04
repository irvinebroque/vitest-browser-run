import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-viewer-ja-jp-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-viewer-ja-jp-mobile');
	});
});
