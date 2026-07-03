import type { Locator } from '@vitest/browser/context';
import type { BrowserCommand, BrowserCommandContext } from 'vitest/node';

import type { BrowserCdpCommandContext as BrowserCdpCommandHandles } from '../types.js';

export type BrowserCdpCommandContext = BrowserCommandContext & BrowserCdpCommandHandles;

export type ScreenshotLocator = SerializedLocator | string;

export interface SerializedLocator {
	selector: string;
	locator: string;
}

export interface ScreenshotCommandOptions {
	element?: ScreenshotLocator;
	mask?: readonly ScreenshotLocator[];
	target?: 'element' | 'page';
	path?: string;
	save?: boolean;
	[key: string]: unknown;
}

export type UserEventCommand<T extends (...args: any[]) => any> = BrowserCommand<ConvertUserEventParameters<Parameters<T>>>;

type ConvertElementToLocator<T> = T extends Element | Locator ? string : T;
type ConvertUserEventParameters<T extends unknown[]> = {
	[K in keyof T]: ConvertElementToLocator<T[K]>;
};

export interface KeyboardState {
	unreleased: string[];
}
