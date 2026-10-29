import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import { ApiHttpError } from "./http.ts";
import { applyRowOperations } from "./rowSync.ts";
import { requestStochasticProjection } from "./sse.ts";
import {
	UserScopeError,
	scopedRequest,
	scopedResponseError,
} from "./scopedRequest.ts";
import { waypointFetch } from "./waypoint-fetch.ts";

const A = `users/${"a".repeat(64)}`;
const B = `users/${"b".repeat(64)}`;

function owner(id = A, baseUrl = "") {
	return acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(baseUrl),
			resource: {
				id,
				kind: "private",
				permissions: ["user:read", "user:project", "user:write"],
			},
			subject: id,
		},
		suspendUserScope(),
	)!;
}

function response(
	body = '{"private":"account-a"}',
	resource: string | null = A,
	status = 200,
) {
	const headers = new Headers({ "content-type": "application/json" });
	if (resource) headers.set("Waypoint-Resource", resource);
	return new Response(body, { status, headers });
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const result = await handler(String(url), init);
		if (result instanceof Error) throw result;
		return result as Response;
	});
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}

function request(kind: "json" | "sse") {
	return kind === "json"
		? waypointFetch<unknown>("/v1/financial-model", { method: "GET" })
		: requestStochasticProjection({ years: 1 });
}

beforeEach(() => owner());
afterEach(() => {
	suspendUserScope();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("resource assertion at the API boundary", () => {
	it("stops a multi-row save after its resource changes between writes", async () => {
		const fetcher = stubFetch(async () => {
			owner(B);
			return response(
				JSON.stringify({ persisted: true, issues: [], revision: "r1" }),
			);
		});
		const result = await applyRowOperations([
			{
				kind: "account",
				action: "create",
				row: {
					id: "a",
					name: "A",
					kind: "cash",
					enabled: true,
					minBalance: null,
					maxBalance: null,
					color: null,
				},
			},
			{
				kind: "account",
				action: "create",
				row: {
					id: "b",
					name: "B",
					kind: "cash",
					enabled: true,
					minBalance: null,
					maxBalance: null,
					color: null,
				},
			},
		]);
		expect(result).toBeInstanceOf(UserScopeError);
		// The first write sends while scope A is current. The scope switch
		// retires the second write before it sends, so nothing computed for
		// plan A can land in plan B's workspace.
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it.each(["json", "sse"] as const)(
		"does not retarget an old %s request to a different user",
		async (kind) => {
			let finish!: (value: Response) => void;
			const pending = new Promise<Response>((resolve) => {
				finish = resolve;
			});
			const fetcher = stubFetch(() => pending);
			const awaiting = request(kind);
			owner(B);
			finish(response("{}", B));
			await expect(awaiting).rejects.toBeInstanceOf(UserScopeError);
			expect(getUserScope().resource?.id).toBe(B);
			const init = (
				fetcher as unknown as { mock: { calls: [string, RequestInit][] } }
			).mock.calls[0]?.[1];
			expect(new Headers(init?.headers).get("Waypoint-Resource")).toBe(A);
		},
	);

	it.each(["json", "sse"] as const)(
		"blocks %s before network access while discovery is pending",
		async (kind) => {
			suspendUserScope();
			const fetcher = stubFetch(async () => response("{}"));
			await expect(request(kind)).rejects.toBeInstanceOf(UserScopeError);
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it("sends the verified assertion, credentials, and redirect policy instead of caller assertions", async () => {
		const fetcher = stubFetch(async () => response());
		const envelope = (await waypointFetch("/v1/status", {
			method: "GET",
			headers: { "Waypoint-Resource": B },
		})) as unknown as { data: unknown };
		expect(envelope.data).toEqual({ private: "account-a" });
		const init = fetcher.mock.calls[0]?.[1] as RequestInit;
		expect(new Headers(init.headers).get("Waypoint-Resource")).toBe(A);
		expect(init).toMatchObject({
			credentials: "same-origin",
			redirect: "error",
			cache: "no-store",
		});
	});

	it.each(["https://unrelated.example", "/unverified-proxy"])(
		"does not attach scoped credentials to %s",
		async (baseUrl) => {
			const fetcher = vi.fn(async () => response());
			const outcome = await scopedRequest(
				baseUrl,
				`${baseUrl}/v1/financial-model`,
				{ method: "GET" },
				fetcher,
				getUserScope(),
			);
			expect(outcome).toBeInstanceOf(UserScopeError);
			expect(fetcher).not.toHaveBeenCalled();
			expect(getUserScope().status).toBe("ready");
		},
	);

	it.each([null, B])(
		"rejects a successful response with resource header %s and requests verification",
		async (resource) => {
			const check = vi.fn();
			window.addEventListener("waypoint:authentication-required", check);
			const fetcher = stubFetch(async () => response(undefined, resource));
			try {
				await expect(
					waypointFetch("/v1/financial-model", { method: "GET" }),
				).rejects.toBeInstanceOf(UserScopeError);
				expect(getUserScope().status).toBe("pending");
				expect(check).toHaveBeenCalledOnce();
				expect(fetcher).toHaveBeenCalledOnce();
			} finally {
				window.removeEventListener("waypoint:authentication-required", check);
			}
		},
	);

	it.each(["json", "sse"] as const)(
		"rejects a late %s response and aborts its request after an account switch",
		async (kind) => {
			let finish: (value: Response) => void = () => {};
			let signal: AbortSignal | null | undefined;
			stubFetch(async (_url, init) => {
				signal = init?.signal ?? null;
				return new Promise<Response>((resolve) => {
					finish = resolve;
				});
			});
			const pending = request(kind);
			owner(B);
			expect(signal?.aborted).toBe(true);
			const cancel = vi.fn();
			finish(
				new Response(new ReadableStream({ cancel }), {
					headers: { "Waypoint-Resource": A },
				}),
			);
			await expect(pending).rejects.toBeInstanceOf(UserScopeError);
			expect(cancel).toHaveBeenCalledOnce();
			expect(getUserScope().resource?.id).toBe(B);
		},
	);

	it("cancels a JSON body mid-read and never returns the old account's data", async () => {
		const cancel = vi.fn();
		let started: () => void = () => {};
		const reading = new Promise<void>((resolve) => {
			started = resolve;
		});
		const body = new ReadableStream<Uint8Array>({
			pull() {
				started();
			},
			cancel,
		});
		stubFetch(
			async () =>
				new Response(body, {
					headers: {
						"Waypoint-Resource": A,
						"content-type": "application/json",
					},
				}),
		);
		const pending = waypointFetch("/v1/financial-model", { method: "GET" });
		await reading;
		// Let the fetch continuation attach the guarded body before changing identity.
		await Promise.resolve();
		owner(B);
		await expect(pending).rejects.toBeInstanceOf(UserScopeError);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("terminates an already-returned SSE stream when the resource changes", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		stubFetch(
			async () =>
				new Response(body, {
					headers: {
						"Waypoint-Resource": A,
						"content-type": "text/event-stream",
					},
				}),
		);
		const result = await requestStochasticProjection({});
		expect(result).toBeInstanceOf(Response);
		const reader = result.body!.getReader();
		const pending = reader.read();
		owner(B);
		await expect(pending).rejects.toBeInstanceOf(UserScopeError);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("forwards caller cancellation to the fetch and stream without a resource change", async () => {
		const caller = new AbortController();
		const cancel = vi.fn();
		let signal: AbortSignal | null | undefined;
		stubFetch(async (_url, init) => {
			signal = init?.signal ?? null;
			return new Response(new ReadableStream({ cancel }), {
				headers: { "Waypoint-Resource": A },
			});
		});
		const result = await requestStochasticProjection(
			{},
			{ signal: caller.signal },
		);
		const pending = result.body!.getReader().read();
		caller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(signal?.aborted).toBe(true);
		expect(cancel).toHaveBeenCalledOnce();
		expect(getUserScope().status).toBe("ready");
	});

	it.each(["json", "sse"] as const)(
		"preserves ordinary %s HTTP failures without a session recheck",
		async (kind) => {
			for (const status of [401, 403, 409, 503]) {
				const scope = getUserScope();
				stubFetch(async () => response("{}", A, status));
				const failure = await request(kind).catch((cause: unknown) => cause);
				expect(failure).toBeInstanceOf(ApiHttpError);
				expect(failure).toMatchObject({ status });
				expect(getUserScope()).toBe(scope);
			}
		},
	);

	it.each(["json", "sse"] as const)(
		"rechecks %s only after the server reports RESOURCE_CHANGED",
		async (kind) => {
			const fetcher = stubFetch(async (_url, init) => {
				expect(new Headers(init?.headers).get("Waypoint-Resource")).toBe(A);
				return response(
					JSON.stringify({ status: 409, code: "RESOURCE_CHANGED" }),
					B,
					409,
				);
			});
			await expect(request(kind)).rejects.toBeInstanceOf(UserScopeError);
			expect(getUserScope().status).toBe("pending");
			expect(fetcher).toHaveBeenCalledOnce();
		},
	);

	it.each([null, A, B])(
		"preserves a duplicate-row conflict with resource header %s",
		async (resource) => {
			const scope = getUserScope();
			const problem = { status: 409, detail: "That account already exists." };
			stubFetch(async () => response(JSON.stringify(problem), resource, 409));
			const failure = await waypointFetch("/v1/accounts", {
				method: "POST",
				body: "{}",
			}).catch((cause: unknown) => cause);
			expect(failure).toBeInstanceOf(ApiHttpError);
			expect(failure).toMatchObject({ status: 409, problem });
			expect((failure as ApiHttpError).message).toBe(
				"The request conflicts with the current server data. That account already exists.",
			);
			expect(getUserScope()).toBe(scope);
		},
	);

	it("preserves a non-409 failure even with a resource-change code", async () => {
		const scope = getUserScope();
		stubFetch(async () =>
			response(
				JSON.stringify({ status: 503, code: "RESOURCE_CHANGED" }),
				A,
				503,
			),
		);
		const failure = await waypointFetch("/v1/financial-model", {
			method: "GET",
		}).catch((cause: unknown) => cause);
		expect(failure).toBeInstanceOf(ApiHttpError);
		expect(failure).toMatchObject({ status: 503 });
		expect(getUserScope()).toBe(scope);
	});

	it("preserves an operation conflict with another problem code", async () => {
		const scope = getUserScope();
		const problem = { status: 409, code: "ID_CONFLICT" };
		stubFetch(async () => response(JSON.stringify(problem), A, 409));
		const failure = await waypointFetch("/v1/accounts", {
			method: "POST",
			body: "{}",
		}).catch((cause: unknown) => cause);
		expect(failure).toBeInstanceOf(ApiHttpError);
		expect(failure).toMatchObject({ status: 409, problem });
		expect(getUserScope()).toBe(scope);
	});

	it("does not invalidate a new user scope for an old resource-change error", () => {
		const oldScope = getUserScope();
		const current = owner(B);
		const result = scopedResponseError(
			oldScope,
			new ApiHttpError({
				message: "The active account changed.",
				status: 409,
				problem: { status: 409, code: "RESOURCE_CHANGED" },
			}),
		);
		expect(result).toBeInstanceOf(UserScopeError);
		expect(getUserScope()).toBe(current);
	});
});
