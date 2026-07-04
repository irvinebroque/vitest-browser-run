import { describe, it } from 'vitest';

import { expectSharedBrowserParallelSlot } from './parallel-helper';

describe('Browser Run shared-browser parallelism slot 01', () => {
	it('runs inside one shared hosted Chromium session', async () => {
		await expectSharedBrowserParallelSlot(1);
	});
});
