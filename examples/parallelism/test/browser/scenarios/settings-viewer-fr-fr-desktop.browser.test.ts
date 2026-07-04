import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: settings-viewer-fr-fr-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('settings-viewer-fr-fr-desktop');
	});
});
