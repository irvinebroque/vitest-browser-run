import { expect } from 'vitest';
import { page } from 'vitest/browser';

import type { VisualStory, VisualViewport } from './visual-stories';
import { renderVisualStory } from './visual-stories';

export async function expectVisualStory(story: VisualStory, viewport: VisualViewport): Promise<void> {
	await page.viewport(viewport.width, viewport.height);
	renderVisualStory(story);
	await document.fonts.ready;
	await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

	const root = document.querySelector<HTMLElement>('[data-testid="visual-root"]');
	expect(root).toBeTruthy();

	await expect.element(root!).toMatchScreenshot(`${story.id}/${viewport.name}`);
}
