import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-viewer-ar-eg-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-viewer-ar-eg-mobile');
	});
});
