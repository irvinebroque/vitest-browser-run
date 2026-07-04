import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-viewer-ar-eg-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-viewer-ar-eg-mobile');
	});
});
