import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: checkout-viewer-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('checkout-viewer-en-us-mobile');
	});
});
