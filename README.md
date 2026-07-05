# Vitest Browser Run

This repo is a proof-of-concept for running Vitest Browser Mode tests on Cloudflare Browser Run through Browser Run's Chrome DevTools Protocol endpoint.

The repo has two parts:

- `packages/browser-run-provider` is the Cloudflare Browser Run connector for Vitest Browser Mode and Playwright CDP.
- `examples/parallelism` is a Worker app and Browser Mode test suite that demonstrates file-level parallelism on Browser Run.

## Parallelism Model

The provider supports a two-level parallelism model:

- Vitest schedules browser test files across `test.maxWorkers`.
- The Browser Run provider assigns those Vitest browser sessions to hosted Chromium sessions.
- Each hosted Chromium session can run multiple isolated pages/contexts.
- `CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS` caps actual Browser Run browser sessions.
- `CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER` caps pages/contexts per hosted browser.

For example, `CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS=2` and `CLOUDFLARE_BROWSER_RUN_SESSIONS_PER_BROWSER=4` gives the provider capacity for up to eight concurrent browser test files across two Browser Run Chromium sessions. Set Vitest `maxWorkers` to the same derived capacity when you want to fill the pool.

If you omit the pool settings, the provider keeps the original efficient default: one Browser Run browser with as many Vitest pages/contexts as `maxWorkers` requires.

## Browser Run Launch Rate

Browser Run currently has a new-browser creation rate limit. The provider paces Browser Run session acquisition with `CLOUDFLARE_BROWSER_RUN_ACQUIRE_INTERVAL_MS` and retries `429` responses using `Retry-After` when available.

## Connector Shape

`browserRunCdp()` acquires Browser Run CDP sessions, provides authorization headers, waits for the local Vitest browser runner to become reachable, rewrites the local runner URL to the public tunnel origin, and opens isolated pages/contexts for Vitest browser sessions:

```ts
browserRunCdp({
	accountId,
	apiToken,
	keepAliveMs: 600000,
	recording: true,
	pool: {
		maxBrowsers: 2,
		sessionsPerBrowser: 4,
	},
})
```

## Running Locally

This branch needs sibling checkouts of the pending upstream Vitest and Workers SDK changes before `pnpm install` will work unchanged.

Set up the Vitest fork:

```sh
cd ..
git clone https://github.com/irvinebroque/vitest.git vitest
cd vitest
git switch feat/playwright-cdp-options
pnpm install
pnpm build
cd ../vitest-browser-run
```

Set up the Workers SDK fork:

```sh
cd ..
git clone --branch vite-tunnel-programmatic-url --single-branch https://github.com/irvinebroque/workers-sdk.git workers-sdk-vite-tunnel-programmatic-url
cd workers-sdk-vite-tunnel-programmatic-url
pnpm install --frozen-lockfile
pnpm --filter @cloudflare/vite-plugin... build
cd ../vitest-browser-run
```

Install this repo:

```sh
pnpm install
```

Run provider unit tests:

```sh
pnpm test
```

Run type checks:

```sh
pnpm typecheck
```

Run the full Browser Run example:

```sh
pnpm test:browser-run
```

Run only the eight-file parallelism proof:

```sh
pnpm test:browser-run:parallel
```

Run only the visual suite:

```sh
pnpm test:browser-run:visual
```

Run the large-app multi-browser Browser Run benchmark:

```sh
pnpm bench:browser-run
```

Run the same benchmark constrained to one hosted Browser Run browser:

```sh
pnpm bench:browser-run:single
```

Run a larger temporary comparison with the same per-browser session cap in local and Browser Run modes:

```sh
BENCHMARK_PROFILE=large \
BENCHMARK_SESSIONS_PER_BROWSER=4 \
CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS=4 \
pnpm bench:compare
```

This runs one benchmark contract across three modes:

- same generated `test/browser/scenarios/**/*.browser.test.ts` files
- same Vitest Browser Mode runner
- same real Chromium browser type
- same `/app/scenario/:id` Worker route and assertions
- same Cloudflare Vite plugin local `workerd` app runtime

The only differences are provider and topology: local Playwright with default local parallelism, Browser Run with one hosted browser, and Browser Run with multiple hosted browsers. Local Chrome is reported as context only; Browser Run speedup compares pooled Browser Run against `browser-run-single`.

The benchmark does not expose a separate total-concurrency setting. Browser Run benchmark `maxWorkers` is derived from `CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS * BENCHMARK_SESSIONS_PER_BROWSER`.

Supported profiles are `default` (96 scenarios), `full` (192), `large` (384), `xlarge` (768), and `stress` (1536). `BENCHMARK_SCENARIO_COUNT=<n>` overrides the profile size.

Benchmark scenarios do not add synthetic app latency. They measure the actual scenario route load, render, data shaping, assertions, provider, and Vitest Browser Mode overhead. Local mode can be much faster because the browser, Vite server, Worker runtime, and CDP control path are all local; Browser Run includes hosted browser acquisition, Cloudflare Tunnel routing, and remote CDP round trips. Reported overlap is observed from scenario event windows; it is not the configured worker cap.

The benchmark runner fails if comparable modes do not emit the same execution contract metadata or the exact same scenario IDs.

Compare fair parallel modes:

```sh
pnpm bench:compare
```

The local benchmark modes use system Chrome by default. Override with `LOCAL_BROWSER_CHANNEL` if your local browser channel is different.

Benchmark reports are written under `examples/parallelism/artifacts/benchmark/`:

- `benchmark-summary.md`
- `benchmark-report.html`
- per-mode `benchmark-events.jsonl`

## Browser Run Credentials

Set Browser Run credentials in either `examples/parallelism/.env`, the repo-root `.env`, or your shell:

```sh
CLOUDFLARE_ACCOUNT_ID="<account-id>"
CLOUDFLARE_API_TOKEN="<token-with-browser-rendering-edit>"
CLOUDFLARE_BROWSER_RUN_MAX_BROWSERS="4"
```

`CLOUDFLARE_API_TOKEN` must have Browser Rendering - Edit permission. The committed example file is `examples/parallelism/.env.example`; real `.env` files stay ignored.
