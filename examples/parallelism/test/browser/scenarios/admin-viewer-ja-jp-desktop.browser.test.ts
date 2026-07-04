import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: admin-viewer-ja-jp-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('admin-viewer-ja-jp-desktop');
	});
});
