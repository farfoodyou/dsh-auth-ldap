/**
 * The login document.
 *
 * Rendered by the plugin itself, so the page works before any client bundle is
 * authorized and needs no build step. Plain HTML plus inline styles: the form
 * must render even when the gated application has not loaded.
 * @module dsh-auth-ldap/login-page
 */

/** Fields the page renders. */
export interface LoginPageOptions {
  /** Action attribute for the form. */
  readonly action: string
  /** Host shown to the user, so they can spot a phishing proxy. */
  readonly authority: string
  /** Value carried back to the application after login. */
  readonly next: string
  /** Message shown above the form, or `''`. */
  readonly error: string
  /** Whether the local account backend is enabled. */
  readonly localEnabled: boolean
  /** Whether the directory backend is enabled. */
  readonly ldapEnabled: boolean
}

/**
 * Escape text for an HTML attribute or text node.
 * @param value - untrusted value.
 * @returns escaped text.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Render the login document.
 * @param options - values to render.
 * @returns complete HTML.
 */
export function renderLoginPage(options: LoginPageOptions): string {
  const hint =
    options.localEnabled && options.ldapEnabled
      ? 'Use your directory account, or a local operator account.'
      : options.ldapEnabled
        ? 'Use your directory account.'
        : 'Use your local operator account.'

  const error =
    options.error === '' ? '' : `<p class="error" role="alert">${escapeHtml(options.error)}</p>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in - DeepSeek Harness</title>
<style>
  :root { color-scheme: light dark; --fg: #1c1c1e; --bg: #f6f6f7; --card: #ffffff; --border: #d8d8dc; --accent: #1f6feb; --error: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e6e6e8; --bg: #16171a; --card: #1e2024; --border: #33363c; --accent: #4c8dff; --error: #ff6b5b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: min(380px, calc(100vw - 2rem)); background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.75rem; }
  h1 { margin: 0 0 .25rem; font-size: 1.15rem; }
  .authority { margin: 0 0 1.25rem; font-size: .8rem; opacity: .7; word-break: break-all; }
  label { display: block; margin: .75rem 0 .25rem; font-size: .85rem; }
  input { width: 100%; padding: .55rem .65rem; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { width: 100%; margin-top: 1.25rem; padding: .6rem; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { filter: brightness(1.08); }
  .hint { margin: 1rem 0 0; font-size: .8rem; opacity: .7; }
  .error { margin: 0 0 1rem; padding: .6rem .7rem; border: 1px solid var(--error); border-radius: 8px; color: var(--error); font-size: .85rem; }
</style>
</head>
<body>
<main>
  <h1>Sign in</h1>
  <p class="authority">${escapeHtml(options.authority)}</p>
  ${error}
  <form method="post" action="${escapeHtml(options.action)}" autocomplete="on">
    <input type="hidden" name="next" value="${escapeHtml(options.next)}">
    <label for="username">Account</label>
    <input id="username" name="username" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
  <p class="hint">${escapeHtml(hint)}</p>
</main>
</body>
</html>
`
}
