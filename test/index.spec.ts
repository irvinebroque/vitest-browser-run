import { env, exports } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Greeting worker', () => {
	it('serves the app shell', async () => {
		const request = new IncomingRequest('http://example.com/?name=Vitest');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(await response.text()).toContain('Hello, Vitest!');
	});

	it('serves the greeting API from the Workers runtime', async () => {
		const response = await exports.default.fetch('https://example.com/api/greeting?name=Cloudflare');
		expect(await response.json()).toEqual({
			greeting: 'Hello, Cloudflare!',
		});
	});
});
