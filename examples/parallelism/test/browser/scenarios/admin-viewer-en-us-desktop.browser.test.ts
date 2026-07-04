import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-viewer-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-viewer-en-us-desktop');
	});
});
