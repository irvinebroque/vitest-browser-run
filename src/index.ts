import { appHtml, greetingFor } from './greeting';

export default {
	async fetch(request, _env, _ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/api/greeting') {
			return Response.json({
				greeting: greetingFor(url.searchParams.get('name')),
			});
		}

		return new Response(appHtml(url.searchParams.get('name') ?? undefined), {
			headers: { 'content-type': 'text/html;charset=UTF-8' },
		});
	},
} satisfies ExportedHandler<Env>;
