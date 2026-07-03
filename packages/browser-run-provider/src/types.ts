import type { Locator } from '@vitest/browser/context';
import type { BrowserContext, CDPSession as PlaywrightCDPSession, Frame, FrameLocator, Page } from 'playwright-core';

export type BrowserCdpSession = Pick<PlaywrightCDPSession, 'send' | 'on' | 'off' | 'once'>;

export interface BrowserCdpCommandContext {
	page: Page;
	context: BrowserContext;
	frame: () => Promise<Frame>;
	iframe: FrameLocator;
}

type PWHoverOptions = NonNullable<Parameters<Page['hover']>[1]>;
type PWClickOptions = NonNullable<Parameters<Page['click']>[1]>;
type PWDoubleClickOptions = NonNullable<Parameters<Page['dblclick']>[1]>;
type PWFillOptions = NonNullable<Parameters<Page['fill']>[2]>;
type PWScreenshotOptions = NonNullable<Parameters<Page['screenshot']>[0]>;
type PWSelectOptions = NonNullable<Parameters<Page['selectOption']>[2]>;
type PWDragAndDropOptions = NonNullable<Parameters<Page['dragAndDrop']>[2]>;
type PWSetInputFilesOptions = NonNullable<Parameters<Page['setInputFiles']>[2]>;

declare module 'vitest/node' {
	export interface BrowserCommandContext extends BrowserCdpCommandContext {}
}

declare module 'vitest/browser' {
	export interface UserEventHoverOptions extends PWHoverOptions {}
	export interface UserEventClickOptions extends PWClickOptions {}
	export interface UserEventDoubleClickOptions extends PWDoubleClickOptions {}
	export interface UserEventTripleClickOptions extends PWClickOptions {}
	export interface UserEventFillOptions extends PWFillOptions {}
	export interface UserEventSelectOptions extends PWSelectOptions {}
	export interface UserEventDragAndDropOptions extends PWDragAndDropOptions {}
	export interface UserEventUploadOptions extends PWSetInputFilesOptions {}

	export interface ScreenshotOptions extends Omit<PWScreenshotOptions, 'mask'> {
		mask?: ReadonlyArray<Element | Locator> | undefined;
	}

	export interface CDPSession extends BrowserCdpSession {}
}
