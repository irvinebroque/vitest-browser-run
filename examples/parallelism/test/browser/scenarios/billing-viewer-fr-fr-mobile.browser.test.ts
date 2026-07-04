import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-viewer-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-viewer-fr-fr-mobile');
	});
});
