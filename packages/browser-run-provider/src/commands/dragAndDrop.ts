import type { UserEvent } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';

export const dragAndDrop: UserEventCommand<UserEvent['dragAndDrop']> = async (context, source, target, options) => {
	const frame = await context.frame();
	await frame.dragAndDrop(source, target, options);
};
