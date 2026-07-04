# Vitest Browser Run

This repo is a proof-of-concept for running Vitest Browser Mode tests on Cloudflare Browser Run through Browser Run's Chrome DevTools Protocol endpoint.

The repo has two parts:

- `packages/browser-run-provider` is the Cloudflare Browser Run connector around `@vitest/browser-playwright`.
- `examples/parallelism` is a Worker app and Browser Mode test suite that demonstrates file-level parallelism on Browser Run.

## Parallelism Model

The example intentionally uses the efficient Playwright/Vitest model:

- Vitest schedules browser test files across `test.maxWorkers`.
- The Playwright provider keeps one connected browser and opens isolated pages/contexts for Vitest browser sessions.
- Browser Run supplies that connected hosted Chromium session over CDP.
- With `CLOUDFLARE_BROWSER_RUN_CONCURRENCY=8`, the example runs eight browser test files at once inside one shared hosted Chromium session.

This is not eight separate Browser Run browser instances. That is deliberate: one Chromium browser can run many pages/contexts, and the example is designed to make good use of that hosted browser rather than burning a new browser per test file.

If future tests need hard process-level isolation, the connector may need a separate `browser-per-session` mode. That mode is not implemented here because the shared-browser path is the simpler and more resource-efficient proof.

## Browser Run Launch Rate

The example does not implement launch throttling because it opens one Browser Run browser for the suite.

Browser Run currently has a new-browser creation rate limit. If a future mode opens one Browser Run browser per Vitest session, launch pacing may be required to avoid `429` responses. That pacing would be a Browser Run service constraint/workaround, not a Vitest feature or something this example should need in the shared-browser model.

## Connector Shape

`browserRunCdp()` builds a Browser Run CDP endpoint, provides the authorization header, waits for the local Vitest browser runner to become reachable, rewrites the local runner URL to the public tunnel origin, and then delegates to `@vitest/browser-playwright`:

```ts
browserRunCdp({
	accountId,
	apiToken,
	keepAliveMs: 600000,
	recording: true,
	publicOrigin: 'https://runner.example.com',
})
```

Internally that becomes a Playwright provider configured with `connectOverCDPOptions` and runner URL hooks.

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

## Browser Run Credentials

Set Browser Run credentials in either `examples/parallelism/.env`, the repo-root `.env`, or your shell:

```sh
CLOUDFLARE_ACCOUNT_ID="<account-id>"
CLOUDFLARE_API_TOKEN="<token-with-browser-rendering-edit>"
CLOUDFLARE_BROWSER_RUN_CONCURRENCY="8"
```

`CLOUDFLARE_API_TOKEN` must have Browser Rendering - Edit permission. The committed example file is `examples/parallelism/.env.example`; real `.env` files stay ignored.
