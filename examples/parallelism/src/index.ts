/// <reference path="../worker-configuration.d.ts" />

import { appHtml, greetingFor } from './greeting';
import { parallelJobFor, parallelLabHtml, readParallelSlot } from './parallel';
import { createScenarioBootstrap, scenarioAppHtml } from './scenarios';

export default {
	async fetch(request, _env, _ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/api/greeting') {
			return Response.json({
				greeting: greetingFor(url.searchParams.get('name')),
			});
		}

		if (url.pathname === '/api/parallel-job') {
			return Response.json(parallelJobFor(readParallelSlot(url.searchParams.get('slot'))));
		}

		if (url.pathname === '/parallel') {
			return new Response(parallelLabHtml(parallelJobFor(readParallelSlot(url.searchParams.get('slot')))), {
				headers: { 'content-type': 'text/html;charset=UTF-8' },
			});
		}

		if (url.pathname === '/api/bootstrap') {
			return Response.json(createScenarioBootstrap(url.searchParams.get('scenario') ?? ''));
		}

		const scenarioMatch = url.pathname.match(/^\/app\/scenario\/([^/]+)$/);
		if (scenarioMatch) {
			return new Response(scenarioAppHtml(decodeURIComponent(scenarioMatch[1]!)), {
				headers: { 'content-type': 'text/html;charset=UTF-8' },
			});
		}

		return new Response(appHtml(url.searchParams.get('name') ?? undefined), {
			headers: { 'content-type': 'text/html;charset=UTF-8' },
		});
	},
} satisfies ExportedHandler<Env>;
