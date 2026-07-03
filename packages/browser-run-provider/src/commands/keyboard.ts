import type { UserEventCommand, KeyboardState } from './types.js';
import { focusIframe, keyboardImplementation, selectAll } from './utils.js';

export const keyboard: UserEventCommand<(text: string, state: KeyboardState) => Promise<KeyboardState>> = async (context, text, state) => {
	const frame = await context.frame();
	await frame.evaluate(focusIframe);

	const pressed = new Set<string>(state.unreleased);
	await keyboardImplementation(
		pressed,
		context.page,
		text,
		async () => {
			const frame = await context.frame();
			await frame.evaluate(selectAll);
		},
		true,
	);

	return {
		unreleased: Array.from(pressed),
	};
};

export const keyboardCleanup: UserEventCommand<(state: KeyboardState) => Promise<void>> = async (context, state) => {
	if (!state.unreleased) {
		return;
	}

	for (const key of state.unreleased) {
		await context.page.keyboard.up(key);
	}
};
