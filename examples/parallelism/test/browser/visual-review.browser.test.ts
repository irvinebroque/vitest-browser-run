import { describe, it } from 'vitest';

import { expectVisualStory } from './visual-helpers';
import { visualStories, visualViewports } from './visual-stories';

describe('Vitest native visual regression: review workflow states', () => {
	for (const viewport of [visualViewports.desktop, visualViewports.mobile]) {
		it(`captures the review form story at ${viewport.name}`, async () => {
			await expectVisualStory(visualStories.form, viewport);
		});
	}
});
