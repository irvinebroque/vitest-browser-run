import type { UserEvent } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';
import { getDescribedLocator } from './utils.js';

export const clear: UserEventCommand<UserEvent['clear']> = async (context, selector) => {
	await getDescribedLocator(context, selector).clear();
};
