import type { UserEvent } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';
import { getDescribedLocator } from './utils.js';

export const click: UserEventCommand<UserEvent['click']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).click(options);
};

export const dblClick: UserEventCommand<UserEvent['dblClick']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).dblclick(options);
};

export const tripleClick: UserEventCommand<UserEvent['tripleClick']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).click({
		...options,
		clickCount: 3,
	});
};
