import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: dashboard-viewer-ar-eg-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('dashboard-viewer-ar-eg-desktop');
	});
});
