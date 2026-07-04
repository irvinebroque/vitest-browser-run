import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: billing-viewer-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('billing-viewer-en-us-desktop');
	});
});
