import { mkdir } from 'node:fs/promises';
import { dirname, normalize, resolve } from 'node:path';

import { asLocator, parseKeyDef, resolveScreenshotPath } from '@vitest/browser';
import type { Locator, UserEvent, UserEventUploadOptions, UserEventWheelDeltaOptions } from '@vitest/browser/context';
import type { BrowserContext, ElementHandle, Frame, FrameLocator, Page } from 'playwright-core';
import type { BrowserCommand, BrowserCommandContext, TestProject } from 'vitest/node';

export type BrowserCdpCommandContext = BrowserCommandContext & {
	page: Page;
	context: BrowserContext;
	frame: () => Promise<Frame>;
	iframe: FrameLocator;
};

type ScreenshotLocator = SerializedLocator | string;

interface SerializedLocator {
	selector: string;
	locator: string;
}

interface ScreenshotCommandOptions {
	element?: ScreenshotLocator;
	mask?: readonly ScreenshotLocator[];
	target?: 'element' | 'page';
	path?: string;
	save?: boolean;
	[key: string]: unknown;
}

type UserEventCommand<T extends (...args: any[]) => any> = BrowserCommand<ConvertUserEventParameters<Parameters<T>>>;

type ConvertElementToLocator<T> = T extends Element | Locator ? string : T;
type ConvertUserEventParameters<T extends unknown[]> = {
	[K in keyof T]: ConvertElementToLocator<T[K]>;
};

interface KeyboardState {
	unreleased: string[];
}

const screenshotCommand: BrowserCommand<[string, ScreenshotCommandOptions], Promise<{ buffer: Buffer; path: string }>> = async (
	context,
	name,
	options = {},
) => {
	const browserContext = context as BrowserCdpCommandContext;

	if (!browserContext.testPath) {
		throw new Error('Cannot take a screenshot without a test path.');
	}

	const path = resolveScreenshotPath(browserContext.testPath, name, browserContext.project.config, options.path);
	const savePath = options.save ? normalize(path) : undefined;

	if (savePath) {
		await mkdir(dirname(savePath), { recursive: true });
	}

	const { element, mask: maskLocators, target, path: _path, save: _save, base64: _base64, ...screenshotOptions } = options;
	const mask = maskLocators?.map((locator) => getDescribedLocator(browserContext, locator));
	const config = {
		...screenshotOptions,
		mask,
		path: savePath,
	} as Parameters<Page['screenshot']>[0];

	const buffer = element
		? await getDescribedLocator(browserContext, element).screenshot(config)
		: target === 'page'
			? await browserContext.page.screenshot(config)
			: await browserContext.iframe.locator('body').screenshot(config);

	return { buffer, path };
};

const viewportCommand: BrowserCommand<[{ width: number; height: number }], Promise<void>> = async (context, viewport) => {
	await (context as BrowserCdpCommandContext).page.setViewportSize(viewport);
};

const clickCommand: UserEventCommand<UserEvent['click']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).click(options);
};

const dblClickCommand: UserEventCommand<UserEvent['dblClick']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).dblclick(options);
};

const tripleClickCommand: UserEventCommand<UserEvent['tripleClick']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).click({
		...options,
		clickCount: 3,
	});
};

const wheelCommand: UserEventCommand<(element: Locator | Element, options: UserEventWheelDeltaOptions) => Promise<void>> = async (
	context,
	selector,
	options,
) => {
	await hoverCommand(context, selector);

	const times = options.times ?? 1;
	const deltaX = options.delta.x ?? 0;
	const deltaY = options.delta.y ?? 0;

	for (let count = 0; count < times; count += 1) {
		await context.page.mouse.wheel(deltaX, deltaY);
	}
};

const typeCommand: UserEventCommand<UserEvent['type']> = async (context, selector, text, options = {}) => {
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

const clearCommand: UserEventCommand<UserEvent['clear']> = async (context, selector) => {
	await getDescribedLocator(context, selector).clear();
};

const fillCommand: UserEventCommand<UserEvent['fill']> = async (context, selector, text, options = {}) => {
	await getDescribedLocator(context, selector).fill(text, options);
};

const tabCommand: UserEventCommand<UserEvent['tab']> = async (context, options = {}) => {
	await context.page.keyboard.press(options.shift === true ? 'Shift+Tab' : 'Tab');
};

const keyboardCommand: UserEventCommand<(text: string, state: KeyboardState) => Promise<KeyboardState>> = async (context, text, state) => {
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

const selectOptionsCommand: UserEventCommand<UserEvent['selectOptions']> = async (context, selector, userValues, options = {}) => {
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

const dragAndDropCommand: UserEventCommand<UserEvent['dragAndDrop']> = async (context, source, target, options) => {
	const frame = await context.frame();
	await frame.dragAndDrop(source, target, options);
};

const hoverCommand: UserEventCommand<UserEvent['hover']> = async (context, selector, options = {}) => {
	await getDescribedLocator(context, selector).hover(options);
};

const uploadCommand: UserEventCommand<(
	element: string,
	files: Array<string | { name: string; mimeType: string; base64: string }>,
	options: UserEventUploadOptions,
) => void> = async (context, selector, files, options) => {
	if (!context.testPath) {
		throw new Error('Cannot upload files outside of a test.');
	}

	const root = context.project.config.root;
	const playwrightFiles = files.map((file) => {
		if (typeof file === 'string') {
			return resolve(root, file);
		}

		return {
			name: file.name,
			mimeType: file.mimeType,
			buffer: Buffer.from(file.base64, 'base64'),
		};
	});

	await getDescribedLocator(context, selector).setInputFiles(playwrightFiles as never, options);
};

const keyboardCleanupCommand: UserEventCommand<(state: KeyboardState) => Promise<void>> = async (context, state) => {
	if (!state.unreleased) {
		return;
	}

	for (const key of state.unreleased) {
		await context.page.keyboard.up(key);
	}
};

const defaultCommands: Record<string, BrowserCommand> = {
	__vitest_upload: uploadCommand as BrowserCommand,
	__vitest_click: clickCommand as BrowserCommand,
	__vitest_dblClick: dblClickCommand as BrowserCommand,
	__vitest_tripleClick: tripleClickCommand as BrowserCommand,
	__vitest_wheel: wheelCommand as BrowserCommand,
	__vitest_takeScreenshot: screenshotCommand as BrowserCommand,
	__vitest_type: typeCommand as BrowserCommand,
	__vitest_clear: clearCommand as BrowserCommand,
	__vitest_fill: fillCommand as BrowserCommand,
	__vitest_tab: tabCommand as BrowserCommand,
	__vitest_keyboard: keyboardCommand as BrowserCommand,
	__vitest_selectOptions: selectOptionsCommand as BrowserCommand,
	__vitest_dragAndDrop: dragAndDropCommand as BrowserCommand,
	__vitest_hover: hoverCommand as BrowserCommand,
	__vitest_cleanup: keyboardCleanupCommand as BrowserCommand,
	__vitest_viewport: viewportCommand as BrowserCommand,
};

export function registerBrowserCdpCommands(project: TestProject, commands: Record<string, BrowserCommand> = {}): void {
	for (const [name, command] of Object.entries({ ...defaultCommands, ...commands })) {
		project.browser!.registerCommand(name as never, command);
	}
}

function getDescribedLocator(context: BrowserCdpCommandContext, locator: ScreenshotLocator): ReturnType<FrameLocator['locator']> {
	if (typeof locator === 'string') {
		const playwrightLocator = context.iframe.locator(locator);
		return typeof playwrightLocator.describe === 'function' ? playwrightLocator.describe(asLocator('javascript', locator)) : playwrightLocator;
	}

	const playwrightLocator = context.iframe.locator(locator.selector);
	return typeof playwrightLocator.describe === 'function' ? playwrightLocator.describe(locator.locator) : playwrightLocator;
}

const validKeyboardKeys = new Set(['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Backquote', '`', '~', 'Digit1', '1', '!', 'Digit2', '2', '@', 'Digit3', '3', '#', 'Digit4', '4', '$', 'Digit5', '5', '%', 'Digit6', '6', '^', 'Digit7', '7', '&', 'Digit8', '8', '*', 'Digit9', '9', '(', 'Digit0', '0', ')', 'Minus', '-', '_', 'Equal', '=', '+', 'Backslash', '\\', '|', 'Backspace', 'Tab', 'KeyQ', 'q', 'Q', 'KeyW', 'w', 'W', 'KeyE', 'e', 'E', 'KeyR', 'r', 'R', 'KeyT', 't', 'T', 'KeyY', 'y', 'Y', 'KeyU', 'u', 'U', 'KeyI', 'i', 'I', 'KeyO', 'o', 'O', 'KeyP', 'p', 'P', 'BracketLeft', '[', '{', 'BracketRight', ']', '}', 'CapsLock', 'KeyA', 'a', 'A', 'KeyS', 's', 'S', 'KeyD', 'd', 'D', 'KeyF', 'f', 'F', 'KeyG', 'g', 'G', 'KeyH', 'h', 'H', 'KeyJ', 'j', 'J', 'KeyK', 'k', 'K', 'KeyL', 'l', 'L', 'Semicolon', ';', ':', 'Quote', '\'', '"', 'Enter', '\n', '\r', 'ShiftLeft', 'Shift', 'KeyZ', 'z', 'Z', 'KeyX', 'x', 'X', 'KeyC', 'c', 'C', 'KeyV', 'v', 'V', 'KeyB', 'b', 'B', 'KeyN', 'n', 'N', 'KeyM', 'm', 'M', 'Comma', ',', '<', 'Period', '.', '>', 'Slash', '/', '?', 'ShiftRight', 'ControlLeft', 'Control', 'MetaLeft', 'Meta', 'AltLeft', 'Alt', 'Space', ' ', 'AltRight', 'AltGraph', 'MetaRight', 'ContextMenu', 'ControlRight', 'PrintScreen', 'ScrollLock', 'Pause', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Home', 'End', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad4', 'Numpad5', 'Numpad6', 'NumpadAdd', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad0', 'NumpadDecimal', 'NumpadEnter', 'ControlOrMeta']);

async function keyboardImplementation(
	pressed: Set<string>,
	page: Page,
	text: string,
	selectAll: () => Promise<void>,
	skipRelease: boolean,
): Promise<void> {
	const actions = parseKeyDef(text);

	for (const { releasePrevious, releaseSelf, repeat, keyDef } of actions) {
		const key = keyDef.key!;

		if (pressed.has(key)) {
			if (validKeyboardKeys.has(key)) {
				await page.keyboard.up(key);
			}
			pressed.delete(key);
		}

		if (!releasePrevious) {
			if (key === 'selectall') {
				await selectAll();
				continue;
			}

			for (let i = 1; i <= repeat; i += 1) {
				if (validKeyboardKeys.has(key)) {
					await page.keyboard.down(key);
				} else {
					await page.keyboard.insertText(key);
				}
			}

			if (releaseSelf) {
				if (validKeyboardKeys.has(key)) {
					await page.keyboard.up(key);
				}
			} else {
				pressed.add(key);
			}
		}
	}

	if (!skipRelease && pressed.size) {
		for (const key of pressed) {
			if (validKeyboardKeys.has(key)) {
				await page.keyboard.up(key);
			}
		}
	}
}

function focusIframe(): void {
	if (!document.activeElement || document.activeElement.ownerDocument !== document || document.activeElement === document.body) {
		window.focus();
	}
}

function selectAll(): void {
	const element = document.activeElement as HTMLInputElement;
	if (element && typeof element.select === 'function') {
		element.select();
	}
}
