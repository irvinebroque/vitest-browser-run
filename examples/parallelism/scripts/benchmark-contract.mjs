export const benchmarkContract = Object.freeze({
	appRoutePattern: '/app/scenario/:id',
	appRuntime: 'cloudflare-vite-plugin-workerd',
	browserMode: 'vitest-browser-mode',
	browserName: 'chromium',
	id: 'browser-mode-scenario-route-v1',
	testCorpus: 'test/browser/scenarios/**/*.browser.test.ts',
	viewport: '1280x800',
});

export function benchmarkContractEnv(providerTopology) {
	return {
		BENCHMARK_APP_ROUTE_PATTERN: benchmarkContract.appRoutePattern,
		BENCHMARK_APP_RUNTIME: benchmarkContract.appRuntime,
		BENCHMARK_BROWSER_MODE: benchmarkContract.browserMode,
		BENCHMARK_BROWSER_NAME: benchmarkContract.browserName,
		BENCHMARK_CONTRACT_ID: benchmarkContract.id,
		BENCHMARK_PROVIDER_TOPOLOGY: providerTopology,
		BENCHMARK_TEST_CORPUS: benchmarkContract.testCorpus,
		BENCHMARK_VIEWPORT: benchmarkContract.viewport,
	};
}
