import type { BrowserCommand, TestProject } from 'vitest/node';

import { clear } from './clear.js';
import { click, dblClick, tripleClick } from './click.js';
import { dragAndDrop } from './dragAndDrop.js';
import { fill } from './fill.js';
import { hover } from './hover.js';
import { keyboard, keyboardCleanup } from './keyboard.js';
import { takeScreenshot } from './screenshot.js';
import { selectOptions } from './select.js';
import { tab } from './tab.js';
import {
	annotateTraces,
	deleteTracing,
	groupTraceEnd,
	groupTraceStart,
	markTrace,
	startChunkTrace,
	startTracing,
	stopChunkTrace,
} from './trace.js';
import { type } from './type.js';
import { upload } from './upload.js';
import { viewport } from './viewport.js';
import { wheel } from './wheel.js';

// These commands intentionally track @vitest/browser-playwright command names so Vitest Browser Mode can reuse its client-side command surface.
const defaultCommands: Record<string, BrowserCommand> = {
	__vitest_upload: upload as BrowserCommand,
	__vitest_click: click as BrowserCommand,
	__vitest_dblClick: dblClick as BrowserCommand,
	__vitest_tripleClick: tripleClick as BrowserCommand,
	__vitest_wheel: wheel as BrowserCommand,
	__vitest_takeScreenshot: takeScreenshot as BrowserCommand,
	__vitest_type: type as BrowserCommand,
	__vitest_clear: clear as BrowserCommand,
	__vitest_fill: fill as BrowserCommand,
	__vitest_tab: tab as BrowserCommand,
	__vitest_keyboard: keyboard as BrowserCommand,
	__vitest_selectOptions: selectOptions as BrowserCommand,
	__vitest_dragAndDrop: dragAndDrop as BrowserCommand,
	__vitest_hover: hover as BrowserCommand,
	__vitest_cleanup: keyboardCleanup as BrowserCommand,
	__vitest_viewport: viewport as BrowserCommand,
	__vitest_deleteTracing: deleteTracing as BrowserCommand,
	__vitest_startChunkTrace: startChunkTrace as BrowserCommand,
	__vitest_startTracing: startTracing as BrowserCommand,
	__vitest_stopChunkTrace: stopChunkTrace as BrowserCommand,
	__vitest_annotateTraces: annotateTraces as BrowserCommand,
	__vitest_markTrace: markTrace as BrowserCommand,
	__vitest_groupTraceStart: groupTraceStart as BrowserCommand,
	__vitest_groupTraceEnd: groupTraceEnd as BrowserCommand,
};

export function registerBrowserCdpCommands(project: TestProject, commands: Record<string, BrowserCommand> = {}): void {
	for (const [name, command] of Object.entries({ ...defaultCommands, ...commands })) {
		project.browser!.registerCommand(name as never, command);
	}
}
