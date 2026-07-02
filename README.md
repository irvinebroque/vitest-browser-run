# Vitest Browser Run

Minimal Cloudflare Worker app plus a Vitest Browser proof-of-concept that drives Cloudflare Browser Run through its CDP endpoint.

## Integration Decision

Adding Cloudflare Browser Run support directly to `@vitest/browser` does not look like the right layer.

`@vitest/browser` is the provider-agnostic browser runner package. It serves the Vitest browser UI/tester through Vite, exposes the custom provider API, and exports helpers like `defineBrowserProvider`. It intentionally does not own browser launch or connection behavior. That work lives in provider packages such as `@vitest/browser-playwright`, `@vitest/browser-webdriverio`, or a custom provider like `test/browser-run-provider.ts` in this repo.

Just exposing a CDP URL is not sufficient by itself. The missing pieces are:

- The provider must call Playwright's `chromium.connectOverCDP()` rather than `browserType.connect()`. The existing `@vitest/browser-playwright` `connectOptions` path is for a Playwright protocol server, not a raw Chrome DevTools Protocol endpoint.
- The provider must own browser/page/context lifecycle for Vitest: `openPage(sessionId, url)`, `close()`, and `getCDPSession(sessionId)`.
- A complete provider must also bridge Vitest Browser interactions to the automation backend by registering commands and returning a Playwright-backed command context. This proof-of-concept only implements enough to load the Vitest browser runner and use `cdp()`/DOM APIs; it does not implement the full locator and `userEvent` surface from `@vitest/browser-playwright`.
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
cloudflared tunnel --url http://localhost:63315
```

In another terminal:

```sh
export CF_ACCOUNT_ID="<account-id>"
export CF_API_TOKEN="<token-with-browser-rendering-edit>"
export VITEST_BROWSER_PUBLIC_ORIGIN="https://<your-tunnel-host>.trycloudflare.com"
npm run test:browser-run
```

Optional settings:

- `CF_BROWSER_RUN_WS_ENDPOINT` overrides the generated Browser Run CDP WebSocket URL.
- `CF_BROWSER_RUN_RECORDING=true` appends `recording=true` so the run appears with a recording in the Cloudflare dashboard after the session closes.
- `CF_BROWSER_RUN_KEEP_ALIVE_MS` controls the `keep_alive` query parameter. The default is `600000`.
