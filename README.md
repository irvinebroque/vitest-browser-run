# Vitest Browser Run

Minimal Cloudflare Worker app plus a Vitest Browser proof-of-concept that uses Cloudflare Browser Run as hosted browser infrastructure.

The important demo is the visual regression path: the browser tests use Vitest's native `toMatchScreenshot()` matcher, while the browser execution happens in remote Cloudflare Browser Run Chromium sessions.

## Where Browser Run Is Used

The Worker application itself does not call Browser Run. Browser Run is used by the Vitest Browser provider that launches the browser for `npm run test:browser-run`.

- `package.json` has the `test:browser-run` script, which runs `vitest.browser-run.config.ts`.
- `vitest.browser-run.config.ts` selects the custom `browserRunCdp()` provider and reads `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_BROWSER_RUN_WS_ENDPOINT`, and `VITEST_BROWSER_PUBLIC_ORIGIN`.
- `test/browser-run-provider.ts` is the actual Browser Run integration. It builds the Cloudflare Browser Run CDP WebSocket URL:

```ts
new URL(`wss://api.cloudflare.com/client/v4/accounts/${this.options.accountId}/browser-rendering/devtools/browser`);
```

- The same provider connects Playwright to that Browser Run CDP endpoint:

```ts
chromium.connectOverCDP(this.getWsEndpoint(), {
	headers: { Authorization: `Bearer ${this.getApiToken()}` },
});
```

There is no `browser` binding in `wrangler.jsonc` because this demo is not launching Browser Run from inside a deployed Worker. It follows Cloudflare's CDP docs: Vitest runs locally or in CI, then connects to Browser Run over WebSocket using an API token.

## Integration Decision

Adding Cloudflare Browser Run support directly to `@vitest/browser` does not look like the right layer.

`@vitest/browser` is the provider-agnostic browser runner package. It serves the Vitest browser UI/tester through Vite, exposes the custom provider API, and exports helpers like `defineBrowserProvider`. It intentionally does not own browser launch or connection behavior. That work lives in provider packages such as `@vitest/browser-playwright`, `@vitest/browser-webdriverio`, or a custom provider like `test/browser-run-provider.ts` in this repo.

Just exposing a CDP URL is not sufficient by itself. The missing pieces are:

- The provider must call Playwright's `chromium.connectOverCDP()` rather than `browserType.connect()`. The existing `@vitest/browser-playwright` `connectOptions` path is for a Playwright protocol server, not a raw Chrome DevTools Protocol endpoint.
- The provider must own browser/page/context lifecycle for Vitest: `openPage(sessionId, url)`, `close()`, and `getCDPSession(sessionId)`.
- A complete provider must also bridge Vitest Browser interactions to the automation backend by registering commands and returning a Playwright-backed command context. This proof-of-concept implements CDP access plus the screenshot command required for Vitest-native visual regression testing; it does not implement the full `userEvent` surface from `@vitest/browser-playwright`.
- The provider now implements the Vitest command needed by native visual regression testing: `__vitest_takeScreenshot`. Vitest still owns baseline creation, `--update`, pixel comparison, and actual/diff artifact generation.
- A remote browser cannot load Vitest's default `localhost` runner URL. Browser Run needs a public origin for the Vitest browser API, provided here as `VITEST_BROWSER_PUBLIC_ORIGIN` and usually backed by a temporary tunnel.
- Browser Run requires authentication headers and its documented CDP WebSocket endpoint: `wss://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/browser-rendering/devtools/browser?keep_alive=600000` with `Authorization: Bearer <API_TOKEN>`.

The best upstream shape would be one of these:

- Add generic CDP connection support to `@vitest/browser-playwright`, for example a `connectOverCDPOptions` branch that uses `chromium.connectOverCDP(wsEndpoint, { headers })`. This is the best fit if Vitest wants first-class support for any remote Chromium CDP provider, not just Cloudflare.
- Publish a small provider package, for example `@cloudflare/vitest-browser-run` or `@vitest/browser-cdp`, that implements the `BrowserProvider` interface and can depend on `playwright-core` without changing Vitest core.
- Add a generic `browser.api.publicOrigin` or similar option in Vitest core if remote-browser providers become common. That would let Vitest pass providers an already-public runner URL instead of each provider rewriting `localhost` URLs itself.

The conclusion for this repo: keep Browser Run integration at the provider layer. Do not add Cloudflare-specific Browser Run logic to `@vitest/browser` itself. If contributing upstream, target `@vitest/browser-playwright` for generic `connectOverCDP` support and consider a small core option for public browser-runner origins.

## Local Worker Tests

```sh
npm test
```

## Browser Run Test

Browser Run is remote, so it cannot open Vitest's default `localhost` browser URL. Expose the Vitest browser API with a temporary tunnel, then point the provider at that public origin.

The browser config enables Vitest's browser API `allowWrite` and `allowExec` because Vitest gates CDP access behind those flags. Use a short-lived tunnel URL and do not share it.

```sh
cloudflared tunnel --url http://127.0.0.1:63315
```

In another terminal:

```sh
export CF_ACCOUNT_ID="<account-id>"
export CF_API_TOKEN="<token-with-browser-rendering-edit>"
export VITEST_BROWSER_PUBLIC_ORIGIN="https://<your-tunnel-host>.trycloudflare.com"
npm run test:browser-run
```

For local development, `vitest.browser-run.config.ts` and `scripts/run-browser-run-visual.mjs` also load missing values from `.dev.vars`, including `CF_ACCOUNT_ID` and `CF_API_TOKEN`.

Optional settings:

- `CF_BROWSER_RUN_WS_ENDPOINT` overrides the generated Browser Run CDP WebSocket URL.
- `CF_BROWSER_RUN_RECORDING=true` appends `recording=true` so the run appears with a recording in the Cloudflare dashboard after the session closes.
- `CF_BROWSER_RUN_KEEP_ALIVE_MS` controls the `keep_alive` query parameter. The default is `600000`.
- `CF_BROWSER_RUN_CONCURRENCY` controls Vitest's worker count for Browser Run visual tests. The default is `4`.
- `CF_BROWSER_RUN_LAUNCH_DELAY_MS` staggers new Browser Run CDP connections. The default is `1100` to avoid starting many remote browsers at the same instant.
- `CF_BROWSER_RUN_BROWSER_PER_SESSION=false` reuses one Browser Run browser outside parallel mode. The default is `true` for parallel visual runs.
- `CF_BROWSER_RUN_LOG_SESSIONS=false` disables provider session logs.

## Native Visual Regression

The visual tests live in `test/browser/visual-*.browser.test.ts` and use the Vitest-native matcher:

```ts
const root = document.querySelector<HTMLElement>('[data-testid="visual-root"]')
await expect.element(root!).toMatchScreenshot('dashboard/desktop')
```

Vitest handles:

- reference screenshot storage in `__screenshots__`
- missing-baseline failures
- `--update` baseline updates
- pixel comparison through the built-in `pixelmatch` comparator
- actual and diff images in `.vitest-attachments`

Create or update Browser Run baselines with:

```sh
npm run ci:browser-run:visual -- --update
```

Run the visual suite against existing baselines with:

```sh
npm run ci:browser-run:visual
```

The `ci:browser-run:visual` helper starts `cloudflared`, waits for the tunnel connection to register, exports `VITEST_BROWSER_PUBLIC_ORIGIN`, and runs the visual suite. If you already have a public origin, set `VITEST_BROWSER_PUBLIC_ORIGIN` and use the lower-level scripts directly:

```sh
npm run test:browser-run:visual
npm run test:browser-run:visual:update
```

## Parallelism Demo

`vitest.browser-run.config.ts` enables Browser Mode file parallelism and sets `maxWorkers` from `CF_BROWSER_RUN_CONCURRENCY`. The custom provider opts into `supportsParallelism` and opens a separate Browser Run CDP browser for each parallel Vitest browser session.

That makes the CI runner mostly an orchestrator:

```txt
GitHub Actions runner
  -> Vitest + Vite browser API
  -> temporary tunnel to `127.0.0.1:63315`
  -> Browser Run Chromium session per parallel Vitest session
  -> Vitest native screenshot baselines/diffs
```

Run the benchmark helper manually when Browser Run credentials are available:

```sh
BROWSER_RUN_BENCHMARK_CONCURRENCY=1,4 npm run benchmark:browser-run
```

The GitHub Actions workflow in `.github/workflows/browser-run-visual.yml` runs the visual suite with `CF_BROWSER_RUN_CONCURRENCY=4`, intentionally does not install local Playwright browsers, and uploads Vitest screenshot artifacts.
