import type { Locator, UserEventWheelDeltaOptions } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';
import { hover } from './hover.js';

export const wheel: UserEventCommand<(element: Locator | Element, options: UserEventWheelDeltaOptions) => Promise<void>> = async (
	context,
	selector,
	options,
) => {
	await hover(context, selector);

	const times = options.times ?? 1;
	const deltaX = options.delta.x ?? 0;
	const deltaY = options.delta.y ?? 0;

	for (let count = 0; count < times; count += 1) {
		await context.page.mouse.wheel(deltaX, deltaY);
	}
};
