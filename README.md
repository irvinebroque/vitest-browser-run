# Vitest Browser Run

This repo is a proof-of-concept for running Vitest Browser Mode tests on Cloudflare Browser Run through Browser Run's Chrome DevTools Protocol endpoint.

The demo focuses on visual regression testing:

- Vitest owns test discovery, test execution, `expect.element(...).toMatchScreenshot()`, baseline updates, and screenshot comparison.
- Cloudflare Browser Run supplies hosted Chromium sessions over a standard CDP WebSocket.
- The custom provider package in `packages/browser-run-provider` is the glue between those two systems.

The Worker application itself does not call Browser Run. Browser Run is only used as the browser infrastructure for Vitest Browser Mode.

## Mechanical Overview

```mermaid
sequenceDiagram
  participant CI as Local machine / GitHub Actions
  participant Vitest as Vitest Browser Mode
  participant Tunnel as Provider tunnel plugin
  participant Provider as browserCdp provider
  participant BR as Cloudflare Browser Run
  participant Chrome as Hosted Chromium

  CI->>Tunnel: browserRunTunnel exposes http://127.0.0.1:63315
  CI->>Vitest: vitest run --config vitest.browser-run.config.ts
  Vitest->>Provider: openPage(sessionId, local runner URL)
  Provider->>Provider: rewrite localhost URL to tunnel URL
  Provider->>BR: chromium.connectOverCDP(wsEndpoint, headers)
  BR->>Chrome: create hosted Chromium session
  Provider->>Chrome: page.goto(public Vitest runner URL)
  Chrome->>Tunnel: request public Vitest runner URL
  Tunnel->>Vitest: forward HTTP/WebSocket traffic to local runner
  Vitest-->>Chrome: serve browser runner and RPC channel
  Vitest->>Provider: __vitest_takeScreenshot command
  Provider->>Chrome: Playwright locator/page screenshot
  Provider-->>Vitest: screenshot buffer + resolved path
  Vitest->>CI: compare/update baselines and write artifacts
```

The key detail is that the browser is remote but the Vitest browser runner is local. The remote browser cannot open `localhost`, so the runner is exposed through a short-lived tunnel and the provider rewrites Vitest's local runner URL to that public origin.

## Main Files

- `package.json` is the private example Worker package and workspace root.
- `pnpm-workspace.yaml` declares local packages under `packages/*`.
- `packages/browser-run-provider` is the reusable Vitest browser provider package consumed by the example via `workspace:*`.
- `vitest.browser-run.config.ts` configures Vitest Browser Mode for Browser Run.
- `packages/browser-run-provider/src/browser-cdp.ts` implements the generic Vitest Browser Mode provider for Chromium CDP endpoints.
- `packages/browser-run-provider/src/browser-run.ts` adapts Cloudflare Browser Run credentials/options into `browserCdp()` connect and runner callbacks.
- `packages/browser-run-provider/src/runner-origin.ts` provides reusable local-to-public runner URL helpers.
- `packages/browser-run-provider/src/commands/**` registers Vitest screenshot, viewport, standard user-event commands, and explicit unsupported tracing commands.
- `packages/browser-run-provider/src/vitest-plugin.ts` starts the quick tunnel from the Vitest config when `VITEST_BROWSER_PUBLIC_ORIGIN` is not already set.
- `packages/browser-run-provider/src/tunnel.ts` preserves the `expose(port)` / `close()` surface from `dmmulroy/tunnels-sdk` while the upstream package is not directly consumable from npm.
- `.github/workflows/browser-run-visual.yml` runs the visual suite in CI without installing local Playwright browsers.
- `test/browser/visual-*.browser.test.ts` contains the visual regression tests.
- `test/browser/__screenshots__/**` contains committed Vitest screenshot baselines.

## Provider Shape

`@vitest-browser-run/browser-run-provider` intentionally separates the generic Vitest/CDP provider from the Cloudflare Browser Run connector.

There are three layers:

- `browserCdp()` is the generic Vitest/CDP provider.
- `browserRunCdp()` is the Cloudflare Browser Run connector.
- `browserRunTunnel()` is an optional tunnel helper for local Vitest runner access.

`browserCdp()` is the upstream-shaped generic layer. It knows about Vitest sessions, Playwright's CDP client, command registration, and lifecycle. It does not know about Browser Run, env vars, public tunnels, or product URL construction.

```ts
browserCdp({
	connect: async ({ sessionId, parallel }) => ({
		wsEndpoint: 'wss://example.com/devtools/browser',
		headers: { Authorization: 'Bearer ...' },
		timeout: 30_000,
	}),
	runner: {
		resolveUrl: async ({ url, sessionId, parallel }) => url,
		waitForReady: async ({ url }) => {},
	},
})
```

If `runner.resolveUrl` is omitted, the provider navigates to Vitest's provided browser runner URL unchanged. If `runner.waitForReady` is omitted, no readiness probe runs.

That layer satisfies Vitest's provider contract using Playwright's CDP client and a `connect()` callback:

- `openPage(sessionId, url, options)` creates or reuses a browser for the Vitest session.
- `close()` closes pages, contexts, and CDP browser connections.
- `getCDPSession(sessionId)` returns the CDP bridge Vitest expects.
- `getCommandsContext(sessionId)` returns the Playwright `page`, `context`, `frame`, and `iframe` handles used by provider commands.
- `__vitest_takeScreenshot` is registered so Vitest's native screenshot matcher can ask Playwright for a screenshot.
- `__vitest_viewport` is registered so `page.viewport(width, height)` works in the tests.
- Standard Vitest user-event commands such as click, hover, fill, type, select, upload, wheel, and drag-and-drop are registered against Playwright locator/input APIs.
- `chromiumCdp()` remains as a compatibility alias with the older default provider name.

`browserRunCdp()` is the Cloudflare-specific connector wrapper:

```ts
browserRunCdp({
	accountId,
	apiToken,
	keepAliveMs: 600000,
	recording: true,
})
```

It builds the Browser Run CDP endpoint and authorization header, configures Browser Run retry/session defaults, rewrites the Vitest runner URL through the configured public origin, waits for the local runner before navigation, and then delegates to `browserCdp()`:

```txt
wss://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/browser-rendering/devtools/browser?keep_alive=600000
Authorization: Bearer <API_TOKEN>
```

If `CF_BROWSER_RUN_RECORDING=true`, the wrapper appends `recording=true` to the CDP URL. Browser Run recordings are available after the browser session closes.

Browser Run-specific behavior is intentionally outside the generic provider: env var resolution, missing `VITEST_BROWSER_PUBLIC_ORIGIN` errors, endpoint construction, auth headers, connection retry classification, context fallback behavior, and Browser Run defaults live in `browser-run.ts`. Reusable public runner origin rewriting lives in `runner-origin.ts`, and GitHub summary output lives in `ci-summary.ts`.

`browserRunCdp()` sets `contextStrategy: 'reuse-default-on-failure'` because some CDP endpoints expose a default browser context but do not allow Playwright to create a fresh context. Generic `browserCdp()` defaults to requiring a new context unless a connector explicitly opts into this fallback.

Because these are normal Browser Run CDP sessions, active sessions can also be inspected with Browser Run Live View from the Cloudflare dashboard. This repo does not fetch or print Live View URLs programmatically.

There is no `browser` binding in `wrangler.jsonc` because this demo does not launch Browser Run from inside a deployed Worker. It connects from Node.js/Vitest to Browser Run's CDP WebSocket, matching Cloudflare's CDP docs for external clients.

## Why A Provider Is Needed

Browser Run exposes a standard Chromium CDP WebSocket. Vitest Browser Mode, however, needs more than a WebSocket URL.

The provider has to:

- Connect Playwright with `chromium.connectOverCDP()`. Vitest's Playwright provider `connectOptions` path uses Playwright protocol, not raw CDP.
- Open the Vitest browser runner page for each Vitest browser session.
- Let connectors optionally rewrite local runner URLs like `http://localhost:63315/__vitest_test__/?sessionId=...` to a public tunnel origin.
- Maintain page/context/browser lifecycle for parallel Vitest sessions.
- Register Vitest browser commands used by the tests and matchers.
- Return screenshot buffers and paths to Vitest so Vitest still owns baseline matching.

That is why this is implemented at the provider layer rather than inside the Worker app or inside `@vitest/browser` itself.

## Why Not `@cloudflare/playwright`

Cloudflare's Browser Run Playwright package is designed for browser automation from Cloudflare Workers through a Browser Run binding. This repo runs in Node.js as a Vitest Browser Mode provider. The relevant Browser Run API for this path is the external CDP WebSocket endpoint, which Cloudflare documents as usable from a local machine, cloud environment, or Workers by CDP-compatible clients such as Playwright and Puppeteer.

That is why this package depends on `playwright-core` and calls `chromium.connectOverCDP()` directly instead of adding a Worker `browser` binding or launching through `@cloudflare/playwright`.

## Supported Surface

Supported today:

- Chromium CDP sessions through Playwright `connectOverCDP()`.
- Vitest Browser Mode page/context/session lifecycle.
- Screenshot and viewport commands.
- Standard user-event commands: click, double-click, triple-click, hover, wheel, type, keyboard, tab, clear, fill, select, upload, and drag-and-drop.
- Browser Run endpoint construction, auth headers, keep-alive, recording, launch staggering, and transient connection retries.
- Local runner URL rewriting through `browserRunCdp()` and optional quick tunnel startup through `browserRunTunnel()`.

Known parity gaps with `@vitest/browser-playwright`:

- Playwright trace commands are registered only to produce clear unsupported-provider errors. Disable `browser.trace` or use `@vitest/browser-playwright` when trace artifacts are required.
- Browser module mocking is not implemented in this provider. Use `@vitest/browser-playwright` for browser tests that depend on provider-backed module mocking.
- Only Chromium CDP is supported.

## Running Locally

Install dependencies:

```sh
pnpm install
```

Run the normal Worker tests:

```sh
pnpm test
```

Set Browser Run credentials in the environment or in `.env`:

```sh
CF_ACCOUNT_ID="<account-id>"
CF_API_TOKEN="<token-with-browser-rendering-edit>"
```

`.env` is ignored by git via `.gitignore` and is loaded by `vitest.browser-run.config.ts` for local development. The ignore rule also covers `.env.local` and environment-specific `.env.*` files, while still allowing a future `.env.example` to be committed.

Run the Browser Run visual suite with an automatic quick tunnel:

```sh
pnpm test:browser-run:visual
```

Update visual baselines:

```sh
pnpm test:browser-run:visual:update
```

If you already have a public origin for the Vitest browser runner, set it and run the same scripts. The tunnel plugin will skip quick tunnel startup:

```sh
export VITEST_BROWSER_PUBLIC_ORIGIN="https://<your-public-origin>"
pnpm test:browser-run:visual
pnpm test:browser-run:visual:update
```

The Vitest config starts the tunnel and configures the provider:

```ts
plugins: [browserRunTunnel({ port: browserApiPort })],
test: {
  browser: {
    provider: browserRunCdp(),
  },
}
```

The tunnel adapter follows the `dmmulroy/tunnels-sdk` quick tunnel shape and uses `cloudflared` internally. It downloads a pinned `cloudflared` binary to `node_modules/.cache/tunnels/bin` when one is not provided, starts a quick tunnel for `http://127.0.0.1:63315`, waits for a `trycloudflare.com` URL and a registered tunnel connection, then closes the tunnel when the Vitest server shuts down.

The adapter is vendored because the SDK package is currently in the `packages/tunnels` workspace of `dmmulroy/tunnels-sdk`, while npm git dependencies install the repository root package (`tunnels-monorepo`) rather than that workspace package. The public `tunnels` package name on npm is an unrelated package, and likely scoped names such as `@dmmulroy/tunnels` are not published. Once the SDK publishes the workspace package or provides a consumable tarball, this file should be replaced with a normal dependency and `import { expose } from '...'`.

Cloudflare quick tunnels intentionally create random `*.trycloudflare.com` hostnames. They are suitable for short-lived CI and demos; use `VITEST_BROWSER_PUBLIC_ORIGIN` if you want to provide a different public runner origin.

## Visual Regression Flow

The visual tests render deterministic DOM fixtures from `test/browser/visual-stories.ts`. They use Vitest's native Browser Mode matcher:

```ts
const root = document.querySelector<HTMLElement>('[data-testid="visual-root"]')
await expect.element(root!).toMatchScreenshot('dashboard/desktop')
```

Vitest handles:

- reference screenshots in `test/browser/__screenshots__/**`
- `--update` baseline writes
- `pixelmatch` comparison
- missing-baseline failures
- actual/diff/reference artifacts under `.vitest-attachments` when comparisons fail

The provider's screenshot command does not implement image diffing. It only takes the screenshot through Playwright and returns the buffer to Vitest.

Committed baselines are platform-specific because Vitest includes the browser and host platform in the default path, for example:

```txt
test/browser/__screenshots__/visual-dashboard.browser.test.ts/dashboard/desktop-chromium-darwin.png
```

## Parallel Browser Run Sessions

`vitest.browser-run.config.ts` enables browser file parallelism and sets `maxWorkers` from `CF_BROWSER_RUN_CONCURRENCY` or `VITEST_MAX_WORKERS`. The default is `4`.

The provider reports `supportsParallelism = true`. With the default `CF_BROWSER_RUN_BROWSER_PER_SESSION=true`, each parallel Vitest browser session gets its own Browser Run CDP browser connection. That is the hosted-browser fan-out this repo is meant to demonstrate.

The provider also staggers CDP connection attempts with `CF_BROWSER_RUN_LAUNCH_DELAY_MS`, defaulting to `1100`, retries transient Browser Run startup failures like `410 Gone` / `state: unhealthy`, and retries transient tunnel navigation failures like `ERR_CONNECTION_RESET` and `ERR_CONNECTION_REFUSED`.

## Configuration

Required for Browser Run:

- `CF_ACCOUNT_ID` or `CLOUDFLARE_ACCOUNT_ID`
- `CF_API_TOKEN` or `CLOUDFLARE_API_TOKEN`

Optional:

- `VITEST_BROWSER_PUBLIC_ORIGIN` skips automatic quick tunnel startup and uses the provided public runner origin.
- `VITEST_BROWSER_API_PORT` changes the local Vitest browser runner port. The default is `63315`.
- `VITEST_BROWSER_API_HOST` changes the local Vitest browser runner host. The default is `0.0.0.0`.
- `TUNNELS_SDK_CLOUDFLARED_PATH` makes the tunnel adapter use an existing `cloudflared` binary instead of downloading one.
- `TUNNELS_SDK_CLOUDFLARED_VERSION` overrides the adapter's pinned `cloudflared` release. The default matches the upstream SDK adapter at `2025.2.0`.
- `CF_BROWSER_RUN_WS_ENDPOINT` bypasses Browser Run URL construction and uses a complete CDP WebSocket URL.
- `CF_BROWSER_RUN_KEEP_ALIVE_MS` controls the Browser Run `keep_alive` query parameter. The default is `600000`.
- `CF_BROWSER_RUN_RECORDING=true` appends `recording=true` so Browser Run records the session.
- `CF_BROWSER_RUN_CONCURRENCY` controls Vitest worker count for Browser Run visual tests. The default is `4`.
- `CF_BROWSER_RUN_BROWSER_PER_SESSION=false` allows non-parallel runs to reuse a single CDP browser connection.
- `CF_BROWSER_RUN_LAUNCH_DELAY_MS` staggers CDP browser connection attempts. The default is `1100`.
- `CF_BROWSER_RUN_LOG_SESSIONS=false` disables provider session logs.

The base Vitest config intentionally keeps this simple:

```ts
provider: browserRunCdp()
```

`browserRunCdp()` reads the Browser Run env vars above and applies defaults internally. Pass explicit options only when a config file needs to override environment-driven behavior.

## CI

`.github/workflows/browser-run-visual.yml` runs on pull requests, pushes to `main`, and manual dispatches.

The workflow:

- installs Node dependencies with `pnpm install --frozen-lockfile`
- intentionally does not install local Playwright browsers
- lets the provider tunnel adapter resolve `cloudflared` for the short-lived public runner URL
- runs `pnpm test:browser-run:visual`
- uploads `test/browser/**/__screenshots__/**` and `.vitest-attachments/**`

The workflow expects these GitHub secrets:

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`

## Upstreaming Notes

The generic integration point is not Cloudflare-specific. This repo now models two possible upstream paths.

Option A: publish or upstream a reusable `@vitest/browser-cdp` provider:

- `browserCdp()` accepts a `connect()` callback that returns `{ wsEndpoint, headers, timeout }`.
- `browserCdp()` accepts a `runner` callback object for runner URL resolution and readiness.
- The provider owns Vitest Browser Mode session/page/context lifecycle and CDP session bridging.
- Connectors such as `browserRunCdp()` own product-specific endpoint construction, auth, defaults, and retry classification.
- Support code such as public runner origin rewriting, tunnel startup, and CI summaries stays outside the generic provider.

Option B: add a `connectOverCDPOptions` path to `@vitest/browser-playwright`:

- This may be cleaner upstream because the implementation is still Playwright-backed.
- Existing Playwright provider command, tracing, mocking, and lifecycle modules could be reused directly instead of mirrored here.
- The important boundary is the same either way: Browser Run should remain a small connector that converts Cloudflare account/token/options into CDP connect options and runner URL behavior.
