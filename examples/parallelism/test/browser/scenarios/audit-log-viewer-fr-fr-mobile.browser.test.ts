import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: audit-log-viewer-fr-fr-mobile', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('audit-log-viewer-fr-fr-mobile');
	});
});
