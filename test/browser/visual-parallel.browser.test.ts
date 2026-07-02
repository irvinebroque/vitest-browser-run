import { describe, it } from 'vitest';

import { expectVisualStory } from './visual-helpers';
import { visualStories, visualViewports } from './visual-stories';

describe('Vitest native visual regression: parallelism proof states', () => {
	for (const viewport of [visualViewports.desktop, visualViewports.mobile]) {
		it(`captures the parallel cards story at ${viewport.name}`, async () => {
			await expectVisualStory(visualStories.cards, viewport);
		});
	}
});
