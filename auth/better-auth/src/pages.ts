import {
  brand,
  controlClass,
  fieldClass,
  ghostButton,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./controls";

export const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

export function page(path: string, query: string, message = "", nonce = "") {
  const signup = path === "/sign-up",
    account = path === "/account",
    device = path === "/device";
  const title = account
    ? "Passkeys"
    : device
      ? "Connect your device"
      : signup
        ? "Create an account"
        : "Sign in";
  const description = account
    ? "Manage the passkeys you use to sign in."
    : device
      ? "Approve only a code from a device you control."
      : signup
        ? "A username and password are all you need."
        : "Sign in to your financial workspace.";
  const search = escapeHTML(query);
  const primary = primaryButton,
    secondary = secondaryButton,
    ghost = ghostButton;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Waypoint</title><link rel="stylesheet" href="/assets/auth.css"><script nonce="${nonce}" type="module" src="/assets/client.js"></script></head>
<body><main class="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-8 px-5 py-10 sm:px-6">
<header><a class="${brand.link}" href="/sign-in${search}" aria-label="Waypoint sign in"><span class="${brand.mark}"><svg class="${brand.icon}" viewBox="0 0 32 32" aria-hidden="true"><path d="${brand.path}" /></svg></span><span>waypoint<span class="text-primary">.</span></span></a></header>
<section class="grid gap-5 rounded-xl border border-solid border-border bg-card p-5 sm:p-6" aria-labelledby="auth-title">
<div class="grid gap-2"><h1 id="auth-title" class="text-2xl font-semibold">${title}</h1><p>${description}</p></div>
<p id="feedback" role="status" aria-live="polite">${escapeHTML(message)}</p>
${
  account
    ? `<p>Keep a backup passkey or your password so you can still sign in if you lose a device.</p><button class="${primary}" id="add-passkey" type="button">Add a passkey</button><ul id="passkeys"></ul><a class="text-sm font-semibold text-primary hover:underline" href="/sign-in">Back to sign in</a>`
    : device
      ? `<form class="grid gap-5" method="post" action="/device${search}"><div class="${fieldClass}"><label class="${labelClass}" for="user-code">Device code</label><input class="${controlClass}" id="user-code" name="userCode" required autocomplete="one-time-code" autocorrect="off" autocapitalize="characters" spellcheck="false"></div><button class="${primary}" type="submit" name="decision" value="approve">Approve device</button><button class="${secondary}" type="submit" name="decision" value="deny">Deny device</button></form>`
      : `
<form class="grid gap-5" method="post" action="${path}${search}">
<div class="${fieldClass}"><label class="${labelClass}" for="username">Username</label><input class="${controlClass}" id="username" name="username" autocomplete="username" autocorrect="off" autocapitalize="off" spellcheck="false" minlength="1" maxlength="64" required></div>
<div class="${fieldClass}"><div class="flex items-center justify-between gap-3"><label class="${labelClass}" for="password">Password</label><button class="${ghost}" id="show-password" type="button" aria-pressed="false" aria-controls="password">Show password</button></div><input class="${controlClass}" id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" maxlength="72" ${signup ? 'aria-describedby="password-hint"' : ""} required>${signup ? '<small id="password-hint" class="text-xs leading-relaxed text-muted-foreground">Use 8–72 characters.</small>' : ""}</div>
<button class="${primary}" type="submit">${signup ? "Create account" : "Sign in"}</button></form>
${signup ? "" : `<button class="${secondary}" id="sign-in-passkey" type="button">Sign in with a passkey</button>`}
<p class="border-0 border-t border-solid border-border pt-5 text-sm">${signup ? "Already have an account?" : "New to Waypoint?"} <a class="font-semibold text-primary hover:underline" href="${signup ? "/sign-in" : "/sign-up"}${search}">${signup ? "Sign in" : "Create an account"}</a></p>`
}
</section><footer class="text-xs text-muted-foreground">${account || device ? "Waypoint account security" : "Need help signing in? Contact your instance operator."}</footer></main></body></html>`;
}
