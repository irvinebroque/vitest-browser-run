import type { BrowserCommand } from 'vitest/node';

import type { BrowserCdpCommandContext } from './types.js';

export const viewport: BrowserCommand<[{ width: number; height: number }], Promise<void>> = async (context, size) => {
	await (context as BrowserCdpCommandContext).page.setViewportSize(size);
};
