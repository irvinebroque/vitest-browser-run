import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: audit-log-viewer-en-us-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('audit-log-viewer-en-us-desktop');
	});
});
