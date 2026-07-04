# Parallelism Example

This example demonstrates Vitest Browser Mode running many test files in parallel on Cloudflare Browser Run.

## What It Proves

The important behavior is config-driven:

```ts
test: {
	fileParallelism: true,
	maxWorkers: Number(process.env.CLOUDFLARE_BROWSER_RUN_CONCURRENCY ?? '8'),
	browser: {
		enabled: true,
		headless: true,
		fileParallelism: true,
		provider: browserRunCdp(),
		instances: [{ browser: 'chromium' }],
	},
}
```

With eight browser test files and `CLOUDFLARE_BROWSER_RUN_CONCURRENCY=8`, Vitest schedules eight files concurrently. The Playwright provider connects to one Browser Run Chromium session and opens pages/contexts for those Vitest browser sessions.

That shared-browser model is intentional. It avoids unnecessary Browser Run browser launches while still proving browser test parallelism.

## Test Shape

The parallel proof lives in:

```txt
test/browser/parallel-slot-01.browser.test.ts
test/browser/parallel-slot-02.browser.test.ts
test/browser/parallel-slot-03.browser.test.ts
test/browser/parallel-slot-04.browser.test.ts
test/browser/parallel-slot-05.browser.test.ts
test/browser/parallel-slot-06.browser.test.ts
test/browser/parallel-slot-07.browser.test.ts
test/browser/parallel-slot-08.browser.test.ts
```

Vitest parallelizes browser files, so this example uses eight files instead of one file with eight `it` blocks. Each file holds its page open for a deterministic period so the overlap is visible in the total run time and Browser Run recording.

## Run It

From the repo root:

```sh
pnpm test:browser-run:parallel
```

From this example package:

```sh
pnpm test:browser-run:parallel
```

Lower the worker count without changing test code:

```sh
CLOUDFLARE_BROWSER_RUN_CONCURRENCY=2 pnpm test:browser-run:parallel
```

## Credentials

Create `.env` in this directory or at the repo root:

```sh
CLOUDFLARE_ACCOUNT_ID="<account-id>"
CLOUDFLARE_API_TOKEN="<token-with-browser-rendering-edit>"
CLOUDFLARE_BROWSER_RUN_CONCURRENCY="8"
```

The token needs Browser Rendering - Edit permission.

## Launch Throttling

This example does not use launch throttling because it opens one Browser Run browser and runs parallel pages/contexts inside it.

If a future mode opens one Browser Run browser per Vitest session, Browser Run's new-browser rate limit may require pacing to avoid `429` responses. That would be a Browser Run limitation/workaround, not a feature of this example.

## Routes

The Worker exposes deterministic routes used by the tests and for manual inspection:

- `/` renders the greeting demo.
- `/api/greeting?name=Cloudflare` returns greeting JSON.
- `/parallel?slot=8` renders a slot-specific parallelism page.
- `/api/parallel-job?slot=8` returns slot metadata.
