export function greetingFor(name: string | null | undefined): string {
	const normalized = name?.trim() || 'Browser Run';
	return `Hello, ${normalized}!`;
}

export function appHtml(defaultName = 'Browser Run'): string {
	const initialGreeting = escapeHtml(greetingFor(defaultName));

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vitest Browser Run</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #f8fafc; }
    main { width: min(36rem, calc(100vw - 2rem)); padding: 2rem; border: 1px solid #334155; border-radius: 1rem; background: #111827; box-shadow: 0 24px 80px #02061799; }
    h1 { margin-top: 0; font-size: clamp(2rem, 8vw, 4rem); letter-spacing: -0.06em; }
    form { display: flex; gap: 0.75rem; }
    input, button { border: 0; border-radius: 999px; padding: 0.9rem 1rem; font: inherit; }
    input { min-width: 0; flex: 1; background: #020617; color: #f8fafc; outline: 1px solid #334155; }
    button { background: #7c3aed; color: white; font-weight: 700; cursor: pointer; }
    [data-testid="greeting"] { margin-bottom: 1.5rem; color: #c4b5fd; font-size: 1.25rem; }
  </style>
</head>
<body>
  <main>
    <h1>Browser Run + Vitest</h1>
    <p data-testid="greeting">${initialGreeting}</p>
    <form data-testid="greeting-form">
      <label for="name" hidden>Name</label>
      <input id="name" name="name" value="${escapeHtml(defaultName)}" autocomplete="off">
      <button type="submit">Greet</button>
    </form>
  </main>
  <script type="module">
    const form = document.querySelector('[data-testid="greeting-form"]');
    const output = document.querySelector('[data-testid="greeting"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const name = formData.get('name') || '';
      const response = await fetch('/api/greeting?name=' + encodeURIComponent(String(name)));
      const data = await response.json();
      output.textContent = data.greeting;
    });
  </script>
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
