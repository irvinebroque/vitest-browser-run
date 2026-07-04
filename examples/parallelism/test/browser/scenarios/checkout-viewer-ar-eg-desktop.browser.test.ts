import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-viewer-ar-eg-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-viewer-ar-eg-desktop');
	});
});
