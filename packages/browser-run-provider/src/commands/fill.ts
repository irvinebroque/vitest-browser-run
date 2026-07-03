import type { UserEvent } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';
import { getDescribedLocator } from './utils.js';

export const fill: UserEventCommand<UserEvent['fill']> = async (context, selector, text, options = {}) => {
	await getDescribedLocator(context, selector).fill(text, options);
};
