import { getApiBaseUrl } from "../api/runtime.ts";

export interface AccountProfile {
	owner: string;
	name: string;
	displayName: string;
	avatar: string;
}

export interface AccountSessionItem {
	id: string;
	current: boolean;
	loginStartedAt: string;
	expiresAt: string;
}

function problem(detail: string, status: number): Error {
	return new Error(status === 401 ? "Sign in to manage your account." : detail);
}

async function readError(response: Response, fallback: string): Promise<Error> {
	let detail = fallback;
	try {
		const body: unknown = await response.json();
		if (
			typeof body === "object" &&
			body !== null &&
			"detail" in body &&
			typeof (body as { detail: unknown }).detail === "string"
		) {
			detail = (body as { detail: string }).detail;
		}
	} catch {
		// Keep the fallback when the error body is not JSON.
	}
	return problem(detail, response.status);
}

export async function getAccountProfile(
	signal?: AbortSignal,
	baseUrl = getApiBaseUrl(),
): Promise<AccountProfile> {
	const response = await fetch(`${baseUrl}/v1/auth/profile`, {
		credentials: "same-origin",
		cache: "no-store",
		signal,
	});
	if (!response.ok)
		throw await readError(response, "Account details are unavailable.");
	const body = (await response.json()) as AccountProfile;
	if (typeof body.name !== "string" || typeof body.owner !== "string") {
		throw new Error("The account service returned an invalid profile.");
	}
	return body;
}

export async function updateAccountProfile(
	input: { displayName?: string; avatar?: string },
	baseUrl = getApiBaseUrl(),
): Promise<AccountProfile> {
	const response = await fetch(`${baseUrl}/v1/auth/profile`, {
		method: "PATCH",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok)
		throw await readError(response, "The account update was rejected.");
	return (await response.json()) as AccountProfile;
}

export async function changeAccountPassword(
	input: { oldPassword: string; newPassword: string },
	baseUrl = getApiBaseUrl(),
): Promise<void> {
	const response = await fetch(`${baseUrl}/v1/auth/change-password`, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok)
		throw await readError(response, "The password change was rejected.");
}

export async function listAccountSessions(
	signal?: AbortSignal,
	baseUrl = getApiBaseUrl(),
): Promise<AccountSessionItem[]> {
	const response = await fetch(`${baseUrl}/v1/auth/sessions`, {
		credentials: "same-origin",
		cache: "no-store",
		signal,
	});
	if (!response.ok)
		throw await readError(response, "The session list is unavailable.");
	const body = (await response.json()) as { sessions?: AccountSessionItem[] };
	if (!Array.isArray(body.sessions))
		throw new Error("The session list is invalid.");
	return body.sessions;
}

export async function revokeAccountSession(
	id: string,
	baseUrl = getApiBaseUrl(),
): Promise<void> {
	const response = await fetch(
		`${baseUrl}/v1/auth/sessions?id=${encodeURIComponent(id)}`,
		{ method: "DELETE", credentials: "same-origin" },
	);
	if (!response.ok)
		throw await readError(response, "That session could not be revoked.");
}
