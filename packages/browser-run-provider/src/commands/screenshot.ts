import { mkdir } from 'node:fs/promises';
import { dirname, normalize } from 'node:path';

import { resolveScreenshotPath } from '@vitest/browser';
import type { Page } from 'playwright-core';
import type { BrowserCommand } from 'vitest/node';

import type { BrowserCdpCommandContext, ScreenshotCommandOptions } from './types.js';
import { getDescribedLocator } from './utils.js';

export const takeScreenshot: BrowserCommand<[string, ScreenshotCommandOptions], Promise<{ buffer: Buffer; path: string }>> = async (
	context,
	name,
	options = {},
) => {
	const browserContext = context as BrowserCdpCommandContext;

	if (!browserContext.testPath) {
		throw new Error('Cannot take a screenshot without a test path.');
	}

	const path = resolveScreenshotPath(browserContext.testPath, name, browserContext.project.config, options.path);
	const savePath = options.save ? normalize(path) : undefined;

	if (savePath) {
		await mkdir(dirname(savePath), { recursive: true });
	}

	const { element, mask: maskLocators, target, path: _path, save: _save, base64: _base64, ...screenshotOptions } = options;
	const mask = maskLocators?.map((locator) => getDescribedLocator(browserContext, locator));
	const config = {
		...screenshotOptions,
		mask,
		path: savePath,
	} as Parameters<Page['screenshot']>[0];

	const buffer = element
		? await getDescribedLocator(browserContext, element).screenshot(config)
		: target === 'page'
			? await browserContext.page.screenshot(config)
			: await browserContext.iframe.locator('body').screenshot(config);

	return { buffer, path };
};
