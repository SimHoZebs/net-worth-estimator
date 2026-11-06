import "webauthn-polyfills";
import type { createAuthClient } from "better-auth/client";

type AuthFetch = ReturnType<typeof createAuthClient>["$fetch"];

function supported() {
  if (!globalThis.isSecureContext || typeof PublicKeyCredential === "undefined")
    throw new Error("Passkeys need a secure connection and a compatible browser.");
}

export async function signInPasskey(fetch: AuthFetch) {
  supported();
  const options = await fetch<PublicKeyCredentialRequestOptionsJSON>(
    "/passkey/generate-authenticate-options",
    { method: "GET" },
  );
  if (!options.data) return options;
  const credential = (await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options.data),
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("Passkey sign-in was canceled.", "NotAllowedError");
  const { clientExtensionResults: _, ...response } = credential.toJSON();
  const result = await fetch<{ redirect?: boolean; url?: string }>(
    "/passkey/verify-authentication",
    { method: "POST", body: { response } },
  );
  // Unknown-credential signals are optional browser synchronization. Never
  // remove a local credential after cancellation or a generic server failure.
  if (result.error?.status === 404 && PublicKeyCredential.signalUnknownCredential) {
    await PublicKeyCredential.signalUnknownCredential({
      rpId: options.data.rpId || location.hostname,
      credentialId: response.id,
    }).catch(() => {});
  }
  return result;
}

export async function registerPasskey(fetch: AuthFetch) {
  supported();
  const name = "My device";
  const options = await fetch<PublicKeyCredentialCreationOptionsJSON>(
    "/passkey/generate-register-options",
    { method: "GET", query: { name } },
  );
  if (!options.data) return options;
  const credential = (await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options.data),
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("Passkey enrollment was canceled.", "NotAllowedError");
  const { clientExtensionResults: _, ...response } = credential.toJSON();
  return fetch("/passkey/verify-registration", { method: "POST", body: { response, name } });
}
