import { createAuthClient } from "better-auth/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { registerPasskey, signInPasskey } from "./passkeys";

const client = createAuthClient({ plugins: [oauthProviderClient()] });
const feedback = document.querySelector("#feedback")!;
const report = (message: string) => {
  feedback.textContent = message;
};
document.querySelector("#show-password")?.addEventListener("click", (event) => {
  const input = document.querySelector<HTMLInputElement>("#password")!;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  const button = event.currentTarget as HTMLButtonElement;
  button.setAttribute("aria-pressed", String(show));
  button.textContent = show ? "Hide password" : "Show password";
});
document.querySelector("#sign-in-passkey")?.addEventListener("click", async () => {
  try {
    const { error, data } = await signInPasskey(client.$fetch);
    if (error) report(error.message || "Passkey sign-in did not complete.");
    else if (!(data as { redirect?: boolean })?.redirect)
      location.assign(
        new URLSearchParams(location.search).get("callbackURL") === "/device"
          ? "/device"
          : "/account",
      );
  } catch {
    report("Passkey sign-in did not complete. Use your password to sign in.");
  }
});
async function listPasskeys() {
  const { data, error } = await client.$fetch<Array<{ id: string; name?: string }>>(
    "/passkey/list-user-passkeys",
  );
  if (error) {
    report("Sign in before you manage passkeys.");
    return;
  }
  const list = document.querySelector("#passkeys")!;
  list.replaceChildren();
  for (const key of data || []) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = key.name || "Passkey";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.setAttribute("aria-label", `Remove ${key.name || "passkey"}`);
    button.addEventListener("click", async () => {
      const result = await client.$fetch("/passkey/delete-passkey", {
        method: "POST",
        body: { id: key.id },
      });
      if (result.error) report(result.error.message || "Could not remove the passkey.");
      else await listPasskeys();
    });
    item.append(label, button);
    list.append(item);
  }
}
document.querySelector("#add-passkey")?.addEventListener("click", async () => {
  try {
    const { error } = await registerPasskey(client.$fetch);
    if (error) report(error.message || "Could not add the passkey.");
    else {
      report("Passkey added.");
      await listPasskeys();
    }
  } catch {
    report(
      "Could not add the passkey. Your browser needs a secure connection and a compatible authenticator.",
    );
  }
});
if (document.querySelector("#passkeys")) void listPasskeys();
