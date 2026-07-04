import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-viewer-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-viewer-fr-fr-mobile');
	});
});
