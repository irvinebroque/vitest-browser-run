export interface VisualStory {
	id: string;
	title: string;
	kicker: string;
	theme: 'aurora' | 'ember' | 'slate';
	status: 'healthy' | 'warning' | 'quiet';
	metric: string;
	metricLabel: string;
	description: string;
	items: string[];
}

export interface VisualViewport {
	name: string;
	width: number;
	height: number;
}

export const visualViewports = {
	mobile: { name: 'mobile', width: 390, height: 720 },
	desktop: { name: 'desktop', width: 1280, height: 800 },
} satisfies Record<string, VisualViewport>;

export const visualStories = {
	dashboard: {
		id: 'dashboard',
		title: 'Hosted browser dashboard',
		kicker: 'Browser Run CI',
		theme: 'aurora',
		status: 'healthy',
		metric: '36',
		metricLabel: 'visual cases',
		description: 'Vitest browser tests fan out across Cloudflare-hosted Chromium sessions and keep screenshot baselines stable in CI.',
		items: ['4 remote sessions active', 'no local Chromium install', 'native Vitest screenshots'],
	},
	empty: {
		id: 'empty-state',
		title: 'No diffs waiting',
		kicker: 'Storyflare review',
		theme: 'slate',
		status: 'quiet',
		metric: '0',
		metricLabel: 'failed snapshots',
		description: 'The report is quiet because the remote rendering environment matched every committed baseline.',
		items: ['baselines committed', 'diff artifacts uploaded', 'ready for merge'],
	},
	cards: {
		id: 'cards',
		title: 'Parallel cards grid',
		kicker: 'Parallelism proof',
		theme: 'ember',
		status: 'warning',
		metric: '4x',
		metricLabel: 'browser fan-out',
		description: 'This story intentionally has several layout regions so screenshot comparison catches spacing, color, and responsive regressions.',
		items: ['queue checkout', 'session recording', 'artifact upload'],
	},
	form: {
		id: 'form-validation',
		title: 'Review gate form',
		kicker: 'Visual approval',
		theme: 'aurora',
		status: 'warning',
		metric: '2',
		metricLabel: 'changes pending',
		description: 'A realistic form state exercises labels, focus rings, validation copy, and dense mobile wrapping.',
		items: ['approve baseline', 'request design review', 'rerun CI'],
	},
} satisfies Record<string, VisualStory>;

export function renderVisualStory(story: VisualStory): void {
	document.head.querySelector('[data-visual-story-style]')?.remove();
	const style = document.createElement('style');
	style.dataset.visualStoryStyle = 'true';
	style.textContent = visualStoryCss;
	document.head.append(style);

	document.documentElement.dataset.theme = story.theme;
	document.body.innerHTML = `
		<main data-testid="visual-root" class="story story--${story.theme}">
			<section class="hero">
				<div>
					<p class="kicker">${escapeHtml(story.kicker)}</p>
					<h1>${escapeHtml(story.title)}</h1>
					<p class="description">${escapeHtml(story.description)}</p>
				</div>
				<div class="metric metric--${story.status}">
					<strong>${escapeHtml(story.metric)}</strong>
					<span>${escapeHtml(story.metricLabel)}</span>
				</div>
			</section>
			<section class="grid" aria-label="Workflow details">
				${story.items.map((item, index) => renderCard(item, index, story.status)).join('')}
			</section>
			<section class="review-panel" aria-label="Visual review status">
				<div>
					<span class="dot dot--${story.status}"></span>
					<span>${statusLabel(story.status)}</span>
				</div>
				<button type="button">Open visual diff</button>
			</section>
		</main>
	`;
}

function renderCard(item: string, index: number, status: VisualStory['status']): string {
	const labels = ['Runner', 'Browser', 'Artifact'];
	return `
		<article class="card">
			<span class="card-index">0${index + 1}</span>
			<h2>${labels[index] ?? 'Step'}</h2>
			<p>${escapeHtml(item)}</p>
			<div class="bar bar--${status}" style="--bar-scale: ${0.45 + index * 0.22}"></div>
		</article>
	`;
}

function statusLabel(status: VisualStory['status']): string {
	switch (status) {
		case 'healthy':
			return 'All visual baselines match';
		case 'warning':
			return 'Review required before merge';
		case 'quiet':
			return 'No visual changes detected';
	}
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>'"]/g, (character) => {
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

const visualStoryCss = `
	:root {
		font-family: Arial, Helvetica, sans-serif;
		background: #05070f;
		color: #f8fafc;
	}

	* {
		box-sizing: border-box;
	}

	*, *::before, *::after {
		animation-duration: 0s !important;
		animation-delay: 0s !important;
		transition-duration: 0s !important;
		transition-delay: 0s !important;
	}

	body {
		margin: 0;
		min-height: 100vh;
		background: radial-gradient(circle at top left, #164e63 0, transparent 34rem), #05070f;
	}

	.story {
		isolation: isolate;
		position: relative;
		width: min(1120px, calc(100vw - 32px));
		min-height: min(720px, calc(100vh - 32px));
		margin: 16px auto;
		padding: clamp(24px, 5vw, 56px);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 32px;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.8));
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
		overflow: hidden;
	}

	.story::before {
		content: '';
		position: absolute;
		inset: auto -10% -24% 35%;
		height: 360px;
		z-index: -1;
		filter: blur(18px);
		background: radial-gradient(circle, var(--accent-soft), transparent 68%);
	}

	.story--aurora {
		--accent: #67e8f9;
		--accent-strong: #22d3ee;
		--accent-soft: rgba(34, 211, 238, 0.28);
	}

	.story--ember {
		--accent: #fed7aa;
		--accent-strong: #fb923c;
		--accent-soft: rgba(251, 146, 60, 0.3);
	}

	.story--slate {
		--accent: #c4b5fd;
		--accent-strong: #8b5cf6;
		--accent-soft: rgba(139, 92, 246, 0.26);
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
		gap: clamp(24px, 5vw, 64px);
		align-items: end;
	}

	.kicker {
		margin: 0 0 16px;
		color: var(--accent);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h1 {
		max-width: 12ch;
		margin: 0;
		font-size: clamp(48px, 8vw, 104px);
		line-height: 0.86;
		letter-spacing: -0.08em;
	}

	.description {
		max-width: 62ch;
		margin: 24px 0 0;
		color: #cbd5e1;
		font-size: clamp(16px, 2vw, 20px);
		line-height: 1.6;
	}

	.metric {
		padding: 28px;
		border-radius: 28px;
		background: rgba(255, 255, 255, 0.08);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
	}

	.metric strong {
		display: block;
		color: var(--accent);
		font-size: clamp(56px, 10vw, 92px);
		line-height: 0.9;
		letter-spacing: -0.08em;
	}

	.metric span {
		display: block;
		margin-top: 12px;
		color: #e2e8f0;
		font-size: 14px;
		font-weight: 700;
		text-transform: uppercase;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		margin-top: clamp(32px, 7vw, 72px);
	}

	.card {
		min-height: 168px;
		padding: 22px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 24px;
		background: rgba(2, 6, 23, 0.54);
	}

	.card-index {
		color: var(--accent);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.18em;
	}

	h2 {
		margin: 28px 0 8px;
		font-size: 22px;
	}

	.card p {
		min-height: 44px;
		margin: 0;
		color: #cbd5e1;
		line-height: 1.4;
	}

	.bar {
		width: calc(var(--bar-scale) * 100%);
		height: 6px;
		margin-top: 22px;
		border-radius: 999px;
		background: var(--accent-strong);
	}

	.review-panel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-top: 18px;
		padding: 18px 20px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: #e2e8f0;
	}

	.review-panel div {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: #94a3b8;
	}

	.dot--healthy {
		background: #22c55e;
	}

	.dot--warning {
		background: #f59e0b;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 12px 18px;
		background: var(--accent-strong);
		color: #020617;
		font: inherit;
		font-weight: 800;
	}

	@media (max-width: 720px) {
		.story {
			width: calc(100vw - 20px);
			min-height: calc(100vh - 20px);
			margin: 10px;
			padding: 24px;
			border-radius: 24px;
		}

		.hero,
		.grid {
			grid-template-columns: 1fr;
		}

		.metric {
			padding: 20px;
		}

		.grid {
			margin-top: 28px;
		}

		.card {
			min-height: 132px;
		}

		.review-panel {
			align-items: stretch;
			border-radius: 24px;
			flex-direction: column;
		}
	}
`;
