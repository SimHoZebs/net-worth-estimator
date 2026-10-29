import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import { ApiHttpError, parseErrorResponse } from "./http.ts";

function response(body: string, init: ResponseInit): Response {
	const headers = new Headers(init.headers);
	headers.set("Waypoint-Resource", "users/sample");
	return new Response(body, { ...init, headers });
}

function scope(baseUrl = "") {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(baseUrl),
			resource: {
				id: "users/sample",
				kind: "sample",
				permissions: ["user:read", "user:project"],
			},
			subject: null,
		},
		suspendUserScope(),
	);
}

beforeEach(() => {
	scope();
	vi.unstubAllGlobals();
});
afterEach(() => suspendUserScope());

describe("shared error taxonomy", () => {
	it.each([
		[401, "Session", 1],
		[401, "Bearer", 0],
		[401, "", 0],
		[403, "Session", 0],
	])(
		"announces session authentication only for status %s and challenge %s",
		async (status, challenge, calls) => {
			const listener = vi.fn();
			window.addEventListener("waypoint:authentication-required", listener);
			try {
				await parseErrorResponse(
					response("Unauthorized", {
						status,
						headers: challenge ? { "WWW-Authenticate": challenge } : {},
					}),
				);
				expect(listener).toHaveBeenCalledTimes(calls);
			} finally {
				window.removeEventListener(
					"waypoint:authentication-required",
					listener,
				);
			}
		},
	);

	it("parses problem+json errors without exposing a raw body field", async () => {
		const result = await parseErrorResponse(
			response(
				JSON.stringify({
					title: "Forbidden",
					status: 403,
					detail: "server is read-only",
				}),
				{
					status: 403,
					headers: { "content-type": "application/problem+json" },
				},
			),
		);
		expect(result).toBeInstanceOf(ApiHttpError);
		expect(result.status).toBe(403);
		expect(result.problem?.status).toBe(403);
		expect(typeof result.detail).toBe("string");
		expect("body" in result).toBe(false);
	});

	it("maps plain-text errors to API errors with the HTTP status", async () => {
		const result = await parseErrorResponse(
			response("service unavailable", {
				status: 503,
				headers: { "content-type": "text/plain" },
			}),
		);
		expect(result).toBeInstanceOf(ApiHttpError);
		expect(result.status).toBe(503);
	});
});
