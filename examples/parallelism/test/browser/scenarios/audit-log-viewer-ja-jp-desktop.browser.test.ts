import { describe, it } from 'vitest';

import { runProductionScenario } from '../scenario-helper';

describe('production scenario: audit-log-viewer-ja-jp-desktop', () => {
	it('validates the configured app surface', async () => {
		await runProductionScenario('audit-log-viewer-ja-jp-desktop');
	});
});
