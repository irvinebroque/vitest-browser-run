import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-admin-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-admin-en-us-desktop');
	});
});
