import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-owner-ja-jp-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-owner-ja-jp-mobile');
	});
});
