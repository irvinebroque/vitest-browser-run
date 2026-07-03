import { asLocator, parseKeyDef } from '@vitest/browser';
import type { FrameLocator, Page } from 'playwright-core';

import type { BrowserCdpCommandContext, ScreenshotLocator } from './types.js';

export function getDescribedLocator(context: BrowserCdpCommandContext, locator: ScreenshotLocator): ReturnType<FrameLocator['locator']> {
	if (typeof locator === 'string') {
		const playwrightLocator = context.iframe.locator(locator);
		return typeof playwrightLocator.describe === 'function' ? playwrightLocator.describe(asLocator('javascript', locator)) : playwrightLocator;
	}

	const playwrightLocator = context.iframe.locator(locator.selector);
	return typeof playwrightLocator.describe === 'function' ? playwrightLocator.describe(locator.locator) : playwrightLocator;
}

const validKeyboardKeys = new Set(['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Backquote', '`', '~', 'Digit1', '1', '!', 'Digit2', '2', '@', 'Digit3', '3', '#', 'Digit4', '4', '$', 'Digit5', '5', '%', 'Digit6', '6', '^', 'Digit7', '7', '&', 'Digit8', '8', '*', 'Digit9', '9', '(', 'Digit0', '0', ')', 'Minus', '-', '_', 'Equal', '=', '+', 'Backslash', '\\', '|', 'Backspace', 'Tab', 'KeyQ', 'q', 'Q', 'KeyW', 'w', 'W', 'KeyE', 'e', 'E', 'KeyR', 'r', 'R', 'KeyT', 't', 'T', 'KeyY', 'y', 'Y', 'KeyU', 'u', 'U', 'KeyI', 'i', 'I', 'KeyO', 'o', 'O', 'KeyP', 'p', 'P', 'BracketLeft', '[', '{', 'BracketRight', ']', '}', 'CapsLock', 'KeyA', 'a', 'A', 'KeyS', 's', 'S', 'KeyD', 'd', 'D', 'KeyF', 'f', 'F', 'KeyG', 'g', 'G', 'KeyH', 'h', 'H', 'KeyJ', 'j', 'J', 'KeyK', 'k', 'K', 'KeyL', 'l', 'L', 'Semicolon', ';', ':', 'Quote', '\'', '"', 'Enter', '\n', '\r', 'ShiftLeft', 'Shift', 'KeyZ', 'z', 'Z', 'KeyX', 'x', 'X', 'KeyC', 'c', 'C', 'KeyV', 'v', 'V', 'KeyB', 'b', 'B', 'KeyN', 'n', 'N', 'KeyM', 'm', 'M', 'Comma', ',', '<', 'Period', '.', '>', 'Slash', '/', '?', 'ShiftRight', 'ControlLeft', 'Control', 'MetaLeft', 'Meta', 'AltLeft', 'Alt', 'Space', ' ', 'AltRight', 'AltGraph', 'MetaRight', 'ContextMenu', 'ControlRight', 'PrintScreen', 'ScrollLock', 'Pause', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Home', 'End', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad4', 'Numpad5', 'Numpad6', 'NumpadAdd', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad0', 'NumpadDecimal', 'NumpadEnter', 'ControlOrMeta']);

export async function keyboardImplementation(
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

export function focusIframe(): void {
	if (!document.activeElement || document.activeElement.ownerDocument !== document || document.activeElement === document.body) {
		window.focus();
	}
}

export function selectAll(): void {
	const element = document.activeElement as HTMLInputElement;
	if (element && typeof element.select === 'function') {
		element.select();
	}
}
