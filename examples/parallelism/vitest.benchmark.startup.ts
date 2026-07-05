import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin, ViteDevServer } from 'vite';
import type { Reporter } from 'vitest/node';

const root = dirname(fileURLToPath(import.meta.url));
const artifactRoot = join(root, 'artifacts/benchmark');
const defaultStartupRequestLimit = 400;

let requestSequence = 0;

export function markBenchmarkStartup(event: string, detail: Record<string, unknown> = {}): void {
	if (process.env.BENCHMARK_STARTUP_TRACE === '0') {
		return;
	}

	const mode = process.env.VITEST_BENCHMARK_MODE;
	if (!mode) {
		return;
	}

	try {
		const modeRoot = join(artifactRoot, mode);
		mkdirSync(modeRoot, { recursive: true });
		appendFileSync(join(modeRoot, 'startup-events.jsonl'), `${JSON.stringify({
			...detail,
			event,
			pid: process.pid,
			timestamp: Date.now(),
		})}\n`);
	}
	catch {
		// Startup tracing must never change benchmark behavior.
	}
}

export function benchmarkStartupTimingPlugin(): Plugin {
	return {
		name: 'benchmark-startup-timings',
		enforce: 'pre',
		config() {
			markBenchmarkStartup('vite:config-hook');
		},
		configResolved(config) {
			markBenchmarkStartup('vite:config-resolved', {
				command: config.command,
				mode: config.mode,
				root: config.root,
			});
		},
		configureServer(server) {
			markBenchmarkStartup('vite:configure-server-start');
			installStartupRequestTracing(server);

			server.httpServer?.once('listening', () => {
				markBenchmarkStartup('vite:http-listening', {
					address: server.httpServer?.address(),
				});
			});

			return () => {
				markBenchmarkStartup('vite:configure-server-end');
			};
		},
	};
}

export function benchmarkStartupReporter(): Reporter {
	const marked = new Set<string>();

	return {
		onInit(vitest) {
			const projectCount = (vitest as { projects?: unknown[] }).projects?.length;
			markBenchmarkStartup('vitest:on-init', {
				projectCount: Array.isArray((vitest as { projects?: unknown[] }).projects) ? projectCount : null,
			});
		},
		onBrowserInit(project) {
			markBenchmarkStartup('vitest:on-browser-init', projectDetail(project));
		},
		onTestRunStart(specifications) {
			markBenchmarkStartup('vitest:on-test-run-start', {
				specificationCount: specifications.length,
			});
		},
		onTestModuleQueued(testModule) {
			markOnce(marked, 'vitest:first-module-queued', moduleDetail(testModule));
		},
		onTestModuleCollected(testModule) {
			markOnce(marked, 'vitest:first-module-collected', moduleDetail(testModule));
		},
		onTestModuleStart(testModule) {
			markOnce(marked, 'vitest:first-module-start', moduleDetail(testModule));
		},
		onTestCaseReady(testCase) {
			markOnce(marked, 'vitest:first-case-ready', testCaseDetail(testCase));
		},
	};
}

function installStartupRequestTracing(server: ViteDevServer): void {
	const requestLimit = Number(process.env.BENCHMARK_STARTUP_REQUEST_LIMIT ?? String(defaultStartupRequestLimit));
	if (!Number.isFinite(requestLimit) || requestLimit <= 0) {
		return;
	}

	server.middlewares.use((request, response, next) => {
		if (!shouldTraceRequest(request.method)) {
			next();
			return;
		}

		const id = requestSequence + 1;
		if (id > requestLimit) {
			next();
			return;
		}

		requestSequence = id;
		const startedAt = Date.now();
		const url = sanitizeUrl(request.url ?? '');
		markBenchmarkStartup('vite:request-start', {
			id,
			method: request.method,
			url,
		});

		response.once('finish', () => {
			markBenchmarkStartup('vite:request-end', {
				durationMs: Date.now() - startedAt,
				id,
				method: request.method,
				statusCode: response.statusCode,
				url,
			});
		});

		next();
	});
}

function markOnce(marked: Set<string>, event: string, detail: Record<string, unknown>): void {
	if (marked.has(event)) {
		return;
	}

	marked.add(event);
	markBenchmarkStartup(event, detail);
}

function projectDetail(project: { name?: string; config?: { browser?: { name?: string } } }): Record<string, unknown> {
	return {
		browserName: project.config?.browser?.name ?? null,
		projectName: project.name ?? null,
	};
}

function moduleDetail(testModule: {
	moduleId?: string;
	project?: { name?: string };
	relativeModuleId?: string;
}): Record<string, unknown> {
	return {
		moduleId: testModule.moduleId ?? null,
		projectName: testModule.project?.name ?? null,
		relativeModuleId: testModule.relativeModuleId ?? null,
	};
}

function testCaseDetail(testCase: {
	id?: string;
	module?: Parameters<typeof moduleDetail>[0];
	name?: string;
	project?: { name?: string };
}): Record<string, unknown> {
	return {
		id: testCase.id ?? null,
		moduleId: testCase.module?.moduleId ?? null,
		name: testCase.name ?? null,
		projectName: testCase.project?.name ?? null,
		relativeModuleId: testCase.module?.relativeModuleId ?? null,
	};
}

function shouldTraceRequest(method: string | undefined): boolean {
	return method === 'GET' || method === 'HEAD';
}

function sanitizeUrl(url: string): string {
	return url.length > 240 ? `${url.slice(0, 237)}...` : url;
}
