import type { UserEvent } from '@vitest/browser/context';

import type { UserEventCommand } from './types.js';

export const tab: UserEventCommand<UserEvent['tab']> = async (context, options = {}) => {
	await context.page.keyboard.press(options.shift === true ? 'Shift+Tab' : 'Tab');
};
