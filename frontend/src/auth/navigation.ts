import { getApiBaseUrl } from "../api/runtime.ts";

export function redirectToSignIn() {
	window.location.replace(`${getApiBaseUrl()}/v1/auth/login`);
}
