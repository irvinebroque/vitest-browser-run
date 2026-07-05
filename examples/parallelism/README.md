# Parallelism Example

This example demonstrates Vitest Browser Mode running many test files in parallel on Cloudflare Browser Run.

## What It Proves

The important behavior is config-driven:

```ts
test: {
	fileParallelism: true,
	maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? '8'),
	browser: {
		enabled: true,
		headless: true,
		fileParallelism: true,
		provider: browserRunCdp({
			pool: {
				maxBrowsers: Number(process.env.CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS ?? '1'),
				sessionsPerBrowser: Number(process.env.CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER ?? '0'),
			},
		}),
		instances: [{ browser: 'chromium' }],
	},
}
```

With eight browser test files and `VITEST_MAX_WORKERS=8`, Vitest schedules eight files concurrently. By default, the provider connects to one Browser Run Chromium session and opens pages/contexts for those Vitest browser sessions.

Set `CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS=2` and `CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER=4` to distribute the same eight Vitest sessions across two hosted Chromium sessions. This lets the suite scale past one browser while still avoiding one browser launch per test file.

## Large-App Benchmark

The benchmark models a production SaaS matrix that large applications commonly struggle to cover:

```txt
routes x roles x locales x viewports x feature flags
```

The committed scenario set contains 96 browser test files generated from:

- 6 product surfaces: dashboard, billing, checkout, admin, settings, audit log
- 4 roles: owner, admin, billing, viewer
- 4 locales sampled across the matrix: `en-US`, `fr-FR`, `ja-JP`, `ar-EG`
- 2 viewports: desktop and mobile
- feature flags attached to each product surface

This shape is meant to mirror real production needs:

- RBAC and permission coverage
- tenant or customer configuration validation
- localization and regional formatting
- checkout and billing variants
- feature flag rollout checks
- post-deploy smoke validation

Each scenario starts a production-style app load, renders scenario-specific data, and asserts the resulting UI without adding synthetic sleep. Browser Run benchmark events also record the Browser Run lease/session assigned by the provider.

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
VITEST_MAX_WORKERS=2 pnpm test:browser-run:parallel
```

Run the default 96-scenario multi-browser Browser Run benchmark:

```sh
pnpm bench:browser-run
```

Run the same Browser Run benchmark constrained to one hosted browser:

```sh
pnpm bench:browser-run:single
```

Benchmark comparison modes share `BENCHMARK_SESSIONS_PER_BROWSER`, which defaults to `4`. In `browser-run-single`, the runner sets one hosted browser with `BENCHMARK_SESSIONS_PER_BROWSER` sessions. In `browser-run`, the runner sets `CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS` hosted browsers with `BENCHMARK_SESSIONS_PER_BROWSER` sessions per browser.

The benchmark does not expose a separate total-concurrency knob. Browser Run benchmark `maxWorkers` is derived from hosted browsers multiplied by sessions per browser.

Run a larger app-shaped benchmark without committing the generated scenario files:

```sh
BENCHMARK_PROFILE=large \
BENCHMARK_SESSIONS_PER_BROWSER=4 \
CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS=4 \
CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS=1000 \
pnpm bench:compare
```

That runs one benchmark contract across three modes:

- same generated `test/browser/scenarios/**/*.browser.test.ts` files
- same Vitest Browser Mode runner
- same real Chromium browser type
- same `/app/scenario/:id` Worker route and assertions
- same Cloudflare Vite plugin local `workerd` app runtime

The only differences are provider and topology: local Playwright with default local parallelism, Browser Run with one hosted browser, and Browser Run with multiple hosted browsers. Local Chrome is reported as context only; Browser Run speedup compares pooled Browser Run against `browser-run-single`.

Profiles:

- `default`: 96 committed scenarios.
- `full`: 192 generated scenarios.
- `large`: 384 generated scenarios.
- `xlarge`: 768 generated scenarios.
- `stress`: 1536 generated scenarios.

Use `BENCHMARK_SCENARIO_COUNT=<n>` to override the profile size. Generated benchmark files are restored to the default committed scenario set after `scripts/run-benchmark.mjs` exits.

Run local comparison modes:

```sh
pnpm bench:local:serial
pnpm bench:local:parallel
```

Compare fair parallel modes in one command:

```sh
pnpm bench:compare
```

`bench:compare` runs `local-parallel`, `browser-run-single`, and `browser-run`. `bench:local:serial` remains available for local-only checks, but it is not part of the default comparison because its worker cap intentionally differs. The runner fails if comparable modes do not emit the same execution contract metadata or the exact same scenario IDs.

Local mode can be much faster because the browser, Vite server, Worker runtime, and CDP control path are all local. Browser Run includes hosted browser acquisition, Cloudflare Tunnel routing, and remote CDP round trips. Reported overlap is observed from scenario event windows; it is not the configured worker cap.

The local modes use system Chrome by default. Override the channel if your local browser is different:

```sh
LOCAL_BROWSER_CHANNEL=msedge pnpm bench:local:parallel
```

Benchmark artifacts are written to `artifacts/benchmark/`:

- `benchmark-summary.md` gives a terminal-friendly table.
- `benchmark-report.html` shows a timeline of overlapping test files and per-browser distribution.
- `<mode>/benchmark-events.jsonl` contains the raw per-scenario timing events.

## Credentials

Create `.env` in this directory or at the repo root:

```sh
CLOUDFLARE_ACCOUNT_ID="<account-id>"
CLOUDFLARE_API_TOKEN="<token-with-browser-rendering-edit>"
CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS="4"
```

The token needs Browser Rendering - Edit permission.

Optional benchmark controls:

```sh
BENCHMARK_SESSIONS_PER_BROWSER="4"
CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS="4"
CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS="1000"
BENCHMARK_PROFILE="large"
BENCHMARK_SCENARIO_COUNT="384"
```

## Launch Throttling

The provider paces new Browser Run session acquisition with `CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS` and retries `429` responses using `Retry-After` when Browser Run asks the client to slow down.

## Routes

The Worker exposes deterministic routes used by the tests and for manual inspection:

- `/` renders the greeting demo.
- `/api/greeting?name=Cloudflare` returns greeting JSON.
- `/parallel?slot=8` renders a slot-specific parallelism page.
- `/api/parallel-job?slot=8` returns slot metadata.
- `/app/scenario/<scenario-id>` renders a production-style scenario page.
- `/api/bootstrap?scenario=<scenario-id>` returns scenario metadata.

## Regenerating Scenarios

The default scenario files are committed so Vitest can discover them immediately. Regenerate the committed default set after changing the matrix in `scripts/generate-scenarios.mjs`:

```sh
pnpm generate:scenarios
```

Generate another profile for local inspection:

```sh
BENCHMARK_PROFILE=large pnpm generate:scenarios
```

Run `pnpm generate:scenarios` again before committing if you generated a non-default profile manually.
