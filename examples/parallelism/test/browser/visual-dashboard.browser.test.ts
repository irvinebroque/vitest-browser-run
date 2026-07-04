import { describe, it } from 'vitest';

import { expectVisualStory } from './visual-helpers';
import { visualStories, visualViewports } from './visual-stories';

describe('Vitest native visual regression: dashboard states', () => {
	for (const viewport of [visualViewports.desktop, visualViewports.mobile]) {
		it(`captures the hosted browser dashboard story at ${viewport.name}`, async () => {
			await expectVisualStory(visualStories.dashboard, viewport);
		});

		it(`captures the empty review story at ${viewport.name}`, async () => {
			await expectVisualStory(visualStories.empty, viewport);
		});
	}
});
