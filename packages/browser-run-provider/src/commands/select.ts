import type { UserEvent } from '@vitest/browser/context';
import type { ElementHandle } from 'playwright-core';

import type { UserEventCommand } from './types.js';
import { getDescribedLocator } from './utils.js';

export const selectOptions: UserEventCommand<UserEvent['selectOptions']> = async (context, selector, userValues, options = {}) => {
	const value = userValues as unknown as (string | { element: string })[];
	const selectElement = getDescribedLocator(context, selector);
	const values = await Promise.all(value.map(async (v) => {
		if (typeof v === 'string') {
			return v;
		}

		const elementHandler = await getDescribedLocator(context, v.element).elementHandle();
		if (!elementHandler) {
			throw new Error(`Element not found: ${v.element}`);
		}

		return elementHandler;
	})) as (readonly string[]) | (readonly ElementHandle[]);

	await selectElement.selectOption(values, options);
};
