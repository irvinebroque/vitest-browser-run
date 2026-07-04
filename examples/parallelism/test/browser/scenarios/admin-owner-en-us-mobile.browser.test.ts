import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-owner-en-us-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-owner-en-us-mobile');
	});
});
