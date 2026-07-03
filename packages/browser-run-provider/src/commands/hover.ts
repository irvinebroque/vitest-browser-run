import type { UserEvent } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';
import { getDescribedLocator } from './utils.js';

export const hover: UserEventCommand<UserEvent['hover']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).hover(options);
};
