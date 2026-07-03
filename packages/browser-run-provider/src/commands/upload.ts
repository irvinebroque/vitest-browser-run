import { resolve } from 'node:path';

import type { UserEventUploadOptions } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';
import { getDescribedLocator } from './utils.js';

export const upload: UserEventCommand<(
	element: string,
	files: Array<string | { name: string; mimeType: string; base64: string }>,
	options: UserEventUploadOptions,
) => void> = async (context, selector, files, options) => {
	if (!context.testPath) {
		throw new Error('Cannot upload files outside of a test.');
	}

	const root = context.project.config.root;
	const playwrightFiles = files.map((file) => {
		if (typeof file === 'string') {
			return resolve(root, file);
		}

		return {
			name: file.name,
			mimeType: file.mimeType,
			buffer: Buffer.from(file.base64, 'base64'),
		};
	});

	await getDescribedLocator(context, selector).setInputFiles(playwrightFiles as never, options);
};
