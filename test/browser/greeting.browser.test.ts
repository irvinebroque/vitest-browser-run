import { describe, expect, it } from 'vitest';
import { cdp, server } from 'vitest/browser';

import { greetingFor } from '../../src/greeting';

describe('Browser Run Vitest browser test', () => {
	it('runs application code in a Browser Run Chromium session', async () => {
		const userAgentResult = (await cdp().send('Runtime.evaluate', {
			expression: 'navigator.userAgent',
			returnByValue: true,
		})) as {
			result: { value: string };
		};

		expect(server.provider).toBe('browser-run-cdp');
		expect(userAgentResult.result.value).toContain('Chrome');

		document.body.innerHTML = `
			<main>
				<label for="name">Name</label>
				<input id="name" value="Cloudflare Browser Run">
				<p data-testid="greeting"></p>
			</main>
		`;

		const input = document.querySelector<HTMLInputElement>('#name');
		const output = document.querySelector<HTMLElement>('[data-testid="greeting"]');

		expect(input).not.toBeNull();
		expect(output).not.toBeNull();

		output!.textContent = greetingFor(input!.value);

		expect(output!.textContent).toBe('Hello, Cloudflare Browser Run!');
	});
});
