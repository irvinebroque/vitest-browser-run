import type { UserEvent } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';
import { getDescribedLocator, keyboardImplementation } from './utils.js';

export const type: UserEventCommand<UserEvent['type']> = async (context, selector, text, options = {}) => {
	const { skipClick = false, skipAutoClose = false } = options;
	const unreleased = new Set(Reflect.get(options, 'unreleased') as string[] ?? []);
	const element = getDescribedLocator(context, selector);

	if (!skipClick) {
		await element.focus();
	}

	await keyboardImplementation(unreleased, context.page, text, () => element.selectText(), skipAutoClose);

	return {
		unreleased: Array.from(unreleased),
	};
};
