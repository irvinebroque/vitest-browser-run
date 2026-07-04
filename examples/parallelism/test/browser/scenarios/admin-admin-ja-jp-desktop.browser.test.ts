import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-admin-ja-jp-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-admin-ja-jp-desktop');
	});
});
