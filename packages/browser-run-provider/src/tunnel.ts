import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const pinnedVersion = process.env.TUNNELS_SDK_CLOUDFLARED_VERSION || '2025.2.0';
const releaseBase = 'https://github.com/cloudflare/cloudflared/releases/download';

export interface TunnelOptions {
	host?: string;
	timeoutMs?: number;
	waitForRegisteredConnection?: boolean;
	logTo?: NodeJS.WritableStream;
	binaryPath?: string;
}

export interface Tunnel {
	url: string;
	close: (signal?: NodeJS.Signals) => Promise<void>;
	[Symbol.asyncDispose]: (signal?: NodeJS.Signals) => Promise<void>;
}

/**
 * Vendored quick-expose surface from dmmulroy/tunnels-sdk.
 *
 * The upstream repo currently keeps the usable SDK package in a monorepo
 * subdirectory that is not published to npm under the documented `tunnels`
 * package name. This preserves the SDK's `expose(port)` API shape while keeping
 * the provider package self-contained.
 *
 * Upstream source:
 * https://github.com/dmmulroy/tunnels-sdk/tree/5de2d2657f4ac22c29d75c45696978c28f4d0a36/packages/tunnels
 */
export async function expose(port: number, options: TunnelOptions = {}): Promise<Tunnel> {
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`Invalid tunnel port: ${port}`);
	}

	const host = options.host || '127.0.0.1';
	const timeoutMs = options.timeoutMs ?? 45_000;
	const waitForRegisteredConnection = options.waitForRegisteredConnection ?? true;
	const logTo = options.logTo;
	const binaryPath = options.binaryPath ?? await ensureCloudflared();
	const args = ['tunnel', '--url', `http://${host}:${port}`, '--no-autoupdate'];
	const proc = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

	let closed = false;
	let url: string | undefined;
	let registered = !waitForRegisteredConnection;
	let settle!: () => void;
	let rejectReady!: (error: Error) => void;

	const exitPromise = new Promise<{ code: number; signal: NodeJS.Signals | null }>((resolve) => {
		proc.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
		proc.once('error', () => resolve({ code: 1, signal: null }));
	});

	const ready = new Promise<void>((resolve, reject) => {
		settle = resolve;
		rejectReady = reject;
	});

	const timeout = setTimeout(() => {
		rejectReady(new Error('Timed out waiting for cloudflared to create and register a trycloudflare.com tunnel.'));
		void close();
	}, timeoutMs);
	timeout.unref?.();

	const maybeReady = (): void => {
		if (url && registered) {
			clearTimeout(timeout);
			settle();
		}
	};

	const onData = (chunk: Buffer): void => {
		const text = chunk.toString();
		logTo?.write(text);

		const match = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
		if (match) {
			url = match[0];
			maybeReady();
		}

		if (text.includes('Registered tunnel connection')) {
			registered = true;
			maybeReady();
		}
	};

	proc.stdout.on('data', onData);
	proc.stderr.on('data', onData);
	proc.once('error', (error) => {
		clearTimeout(timeout);
		rejectReady(new Error(`Failed to start cloudflared through the tunnels SDK adapter. ${error.message}`));
	});
	proc.once('exit', (code, signal) => {
		if (!url || !registered) {
			clearTimeout(timeout);
			rejectReady(new Error(`cloudflared exited before creating a ready tunnel. Exit code: ${code ?? 'null'}, signal: ${signal ?? 'none'}`));
		}
	});

	await ready;

	async function close(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
		if (closed) {
			return;
		}

		closed = true;
		clearTimeout(timeout);

		if (!proc.killed) {
			proc.kill(signal);
		}

		await Promise.race([
			exitPromise,
			new Promise((resolve) => setTimeout(resolve, 5_000)),
		]);
	}

	return {
		url: url!,
		close,
		[Symbol.asyncDispose]: close,
	};
}

export const cloudflared = {
	get path(): string {
		return join(getCacheDir(), getBinaryName());
	},
	get version(): string {
		return normalizeVersion(pinnedVersion);
	},
	async isInstalled(): Promise<boolean> {
		if (!existsSync(this.path)) {
			return false;
		}

		try {
			const { stdout } = await execFileAsync(this.path, ['--version']);
			return String(stdout).includes('cloudflared') && String(stdout).includes(this.version);
		} catch {
			return false;
		}
	},
	async install(): Promise<void> {
		await installCloudflared(this.path, this.version);
	},
	async remove(): Promise<void> {
		await rm(getCacheDir(), { recursive: true, force: true });
	},
};

async function ensureCloudflared(): Promise<string> {
	if (process.env.TUNNELS_SDK_CLOUDFLARED_PATH) {
		return process.env.TUNNELS_SDK_CLOUDFLARED_PATH;
	}

	if (!await cloudflared.isInstalled()) {
		await cloudflared.install();
	}

	return cloudflared.path;
}

async function installCloudflared(binaryPath: string, version: string): Promise<void> {
	await mkdir(getCacheDir(), { recursive: true });

	const response = await fetch(getDownloadUrl(version), { redirect: 'follow' });
	if (!response.ok) {
		throw new Error(`Failed to download cloudflared ${version}: ${response.status} ${response.statusText}`);
	}

	if (platform() === 'darwin') {
		await extractTgz(response, getCacheDir());
	} else {
		const body = response.body;
		if (!body) {
			throw new Error('Empty cloudflared download response body.');
		}

		await pipeline(Readable.fromWeb(body as never), createWriteStream(binaryPath));
	}

	if (platform() !== 'win32') {
		await chmod(binaryPath, 0o755);
	}
}

async function extractTgz(response: Response, destDir: string): Promise<void> {
	const body = response.body;
	if (!body) {
		throw new Error('Empty cloudflared download response body.');
	}

	const tar = spawn('tar', ['xzf', '-', '-C', destDir], { stdio: ['pipe', 'ignore', 'pipe'] });
	await pipeline(Readable.fromWeb(body as never), tar.stdin);

	await new Promise<void>((resolve, reject) => {
		tar.once('close', (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`tar extraction failed with code ${code}`));
		});
		tar.once('error', reject);
	});
}

function getDownloadUrl(version: string): string {
	return `${releaseBase}/${normalizeVersion(version)}/${getAssetName()}`;
}

function normalizeVersion(version: string): string {
	return version.replace(/^v/, '');
}

function getAssetName(): string {
	const currentPlatform = platform();
	const currentArch = arch();

	if (currentPlatform === 'darwin') {
		if (currentArch !== 'arm64' && currentArch !== 'x64') {
			throw new Error(`Unsupported architecture: ${currentPlatform}-${currentArch}`);
		}
		return `cloudflared-darwin-${currentArch === 'arm64' ? 'arm64' : 'amd64'}.tgz`;
	}

	if (currentPlatform === 'linux') {
		if (currentArch !== 'arm64' && currentArch !== 'x64') {
			throw new Error(`Unsupported architecture: ${currentPlatform}-${currentArch}`);
		}
		return `cloudflared-linux-${currentArch === 'arm64' ? 'arm64' : 'amd64'}`;
	}

	if (currentPlatform === 'win32') {
		if (currentArch !== 'x64') {
			throw new Error(`Unsupported architecture: ${currentPlatform}-${currentArch}`);
		}
		return 'cloudflared-windows-amd64.exe';
	}

	throw new Error(`Unsupported platform: ${currentPlatform}`);
}

function getBinaryName(): string {
	return platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function getCacheDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i += 1) {
		const nodeModulesDir = join(dir, 'node_modules');
		if (existsSync(nodeModulesDir)) {
			return join(nodeModulesDir, '.cache', 'tunnels', 'bin');
		}

		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}

	return join(process.cwd(), 'node_modules', '.cache', 'tunnels', 'bin');
}
