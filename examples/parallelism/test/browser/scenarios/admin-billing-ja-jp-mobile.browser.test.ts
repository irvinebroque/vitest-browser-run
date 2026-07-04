import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-billing-ja-jp-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-billing-ja-jp-mobile');
	});
});
