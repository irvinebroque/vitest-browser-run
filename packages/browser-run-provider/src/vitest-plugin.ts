import { writeBrowserRunSummary } from './ci-summary.js';
import { expose, type Tunnel, type TunnelOptions } from './tunnel.js';

export interface BrowserRunTunnelOptions extends Pick<TunnelOptions, 'binaryPath' | 'timeoutMs' | 'waitForRegisteredConnection'> {
	enabled?: boolean;
	host?: string;
	port?: number;
	publicOrigin?: string;
	publicOriginEnv?: string;
	logTo?: NodeJS.WritableStream;
	summary?: boolean;
}

interface BrowserRunTunnelPlugin {
	name: string;
	apply: 'serve';
	configureServer: (server: ViteDevServerLike) => Promise<void>;
	closeBundle: () => Promise<void>;
}

interface ViteDevServerLike {
	config: {
		server?: {
			port?: number;
		};
		logger?: {
			info: (message: string) => void;
		};
	};
	httpServer?: {
		once: (event: 'close', listener: () => void) => void;
	};
}

export function browserRunTunnel(options: BrowserRunTunnelOptions = {}): BrowserRunTunnelPlugin {
	const publicOriginEnv = options.publicOriginEnv ?? 'VITEST_BROWSER_PUBLIC_ORIGIN';
	let tunnel: Tunnel | undefined;
	let publicOrigin = '';
	let startedAt = 0;
	let closePromise: Promise<void> | undefined;

	async function closeTunnel(): Promise<void> {
		if (closePromise) {
			return closePromise;
		}

		closePromise = (async () => {
			await tunnel?.close();
			await writeBrowserRunSummary({
				publicOrigin,
				durationMs: startedAt > 0 ? Date.now() - startedAt : 0,
				summary: options.summary,
			});
		})();

		return closePromise;
	}

	return {
		name: 'browser-run-tunnel',
		apply: 'serve',
		async configureServer(server) {
			if (options.enabled === false) {
				return;
			}

			const configuredOrigin = options.publicOrigin ?? process.env[publicOriginEnv];
			if (configuredOrigin) {
				publicOrigin = configuredOrigin;
				process.env[publicOriginEnv] = configuredOrigin;
				return;
			}

			const port = options.port ?? server.config.server?.port ?? readPortFromEnv();
			if (!Number.isInteger(port) || port <= 0 || port > 65535) {
				throw new Error(`Invalid Vitest browser API port for Browser Run tunnel: ${port}`);
			}

			startedAt = Date.now();
			tunnel = await expose(port, {
				binaryPath: options.binaryPath,
				host: options.host ?? '127.0.0.1',
				logTo: options.logTo ?? process.stderr,
				timeoutMs: options.timeoutMs,
				waitForRegisteredConnection: options.waitForRegisteredConnection,
			});

			publicOrigin = tunnel.url;
			process.env[publicOriginEnv] = publicOrigin;
			server.config.logger?.info(`[browser-run-tunnel] exposed Vitest browser runner at ${publicOrigin}`);
			server.httpServer?.once('close', () => {
				void closeTunnel();
			});
		},
		closeBundle: closeTunnel,
	};
}

function readPortFromEnv(): number {
	return Number(process.env.VITEST_BROWSER_API_PORT ?? '63315');
}
