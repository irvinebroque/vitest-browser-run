import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: audit-log-admin-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('audit-log-admin-en-us-desktop');
	});
});
