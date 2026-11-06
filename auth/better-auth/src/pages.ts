export const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

export function page(path: string, query: string, message = "", nonce = "") {
  const signup = path === "/sign-up";
  const account = path === "/account";
  const device = path === "/device";
  const title = account
    ? "Your sign-in keys"
    : device
      ? "Connect your device"
      : signup
        ? "Make room for your future."
        : "Welcome back.";
  const search = escapeHTML(query);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Waypoint</title><link rel="stylesheet" href="/assets/auth.css"><script nonce="${nonce}" type="module" src="/assets/client.js"></script></head>
<body><main><header><a href="/sign-in${search}" aria-label="Waypoint sign in">W<span>WAYPOINT</span></a><p>A clearer view of what comes next.</p></header>
<section><p class="eyebrow">${account ? "ACCOUNT SECURITY" : device ? "DEVICE SIGN-IN" : "YOUR FINANCIAL WORKSPACE"}</p><h1>${title}</h1>
<p id="feedback" role="status" aria-live="polite">${escapeHTML(message)}</p>
${
  account
    ? `<p>Passkeys let you sign in with your device instead of a password. Keep a backup key or your password.</p><button id="add-passkey" type="button">Add a passkey</button><ul id="passkeys"></ul><a href="/sign-in">Back to sign in</a>`
    : device
      ? `<p>Approve only a code from a device you control.</p><form method="post" action="/device${search}"><label for="user-code">Device code</label><input id="user-code" name="userCode" required autocomplete="one-time-code" autocorrect="off" autocapitalize="characters" spellcheck="false"><button type="submit" name="decision" value="approve">Approve device</button><button type="submit" name="decision" value="deny">Deny device</button></form>`
      : `
<form method="post" action="${path}${search}">
<label for="username">Username</label><input id="username" name="username" autocomplete="username" autocorrect="off" autocapitalize="off" spellcheck="false" minlength="1" maxlength="64" required>
${signup ? `<label for="name">Display name</label><input id="name" name="name" autocomplete="name" maxlength="128" required>` : ""}
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" maxlength="72" required><button id="show-password" type="button" aria-pressed="false">Show password</button>
${signup ? "<p>Use 8–72 characters. No email address is required.</p>" : ""}
<button type="submit">${signup ? "Create account" : "Sign in"}</button></form>
${signup ? "" : `<button id="sign-in-passkey" type="button">Sign in with a passkey</button>`}
<p>${signup ? "Already have a workspace?" : "New to Waypoint?"} <a href="${signup ? "/sign-in" : "/sign-up"}${search}">${signup ? "Sign in" : "Create an account"}</a></p><p class="muted">For account recovery, contact your instance operator.</p>`
}
</section><footer>Your data stays in your workspace.</footer></main></body></html>`;
}
