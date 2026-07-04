export interface ParallelJob {
	slot: number;
	label: string;
	delayMs: number;
	phases: string[];
}

const defaultParallelDelayMs = 8000;

export function readParallelSlot(value: string | null | undefined): number {
	const parsed = Number.parseInt(value ?? '', 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return 1;
	}

	return Math.min(parsed, 64);
}

export function parallelJobFor(slot: number, delayMs = defaultParallelDelayMs): ParallelJob {
	const normalizedSlot = readParallelSlot(String(slot));
	return {
		slot: normalizedSlot,
		label: `Parallel slot ${String(normalizedSlot).padStart(2, '0')}`,
		delayMs,
		phases: [
			'claim Vitest browser worker',
			'render isolated page state',
			'hold the slot open for overlap',
			'complete integration assertion',
		],
	};
}

export function parallelLabHtml(job: ParallelJob): string {
	const phases = job.phases.map((phase) => `<li>${escapeHtml(phase)}</li>`).join('');

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(job.label)} - Browser Run parallel lab</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #020617; color: #f8fafc; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top right, #1d4ed8 0, transparent 28rem), #020617; }
    main { width: min(48rem, calc(100vw - 2rem)); padding: 2rem; border: 1px solid #1e293b; border-radius: 1.5rem; background: rgba(15, 23, 42, 0.92); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42); }
    p { color: #cbd5e1; line-height: 1.6; }
    strong { color: #93c5fd; }
    li { margin-block: 0.45rem; color: #dbeafe; }
  </style>
</head>
<body>
  <main>
    <p><strong>Browser Run shared-browser parallelism</strong></p>
    <h1>${escapeHtml(job.label)}</h1>
    <p>This page represents one Vitest browser test file running inside a shared hosted Chromium session.</p>
    <p>Slot delay: ${job.delayMs}ms</p>
    <ol>${phases}</ol>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			default:
				return '&#39;';
		}
	});
}
