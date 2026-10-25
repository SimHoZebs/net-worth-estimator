import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	getResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { ApiClient, ApiHttpError, type FetchLike } from "./client.ts";
import { applyRowOperations } from "./rowSync.ts";
import {
	ResourceScopeError,
	resourceScopedFactory,
	scopedResponseError,
} from "./scopedRequest.ts";

const A = `plans/${"a".repeat(64)}`;
const B = `plans/${"b".repeat(64)}`;

function owner(id = A, baseUrl = "") {
	return acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(baseUrl),
			resource: {
				id,
				kind: "private",
				permissions: ["plan:read", "plan:project", "plan:write"],
			},
			subject: id,
		},
		suspendResourceScope(),
	)!;
}

function response(
	body = '{"private":"account-a"}',
	resource: string | null = A,
	status = 200,
) {
	const headers = new Headers({ "content-type": "application/json" });
	if (resource) headers.set("X-Waypoint-Resource", resource);
	return new Response(body, { status, headers });
}

function request(client: ApiClient, kind: "json" | "sse") {
	return kind === "json"
		? client.getModel()
		: client.projectStochastic({} as never);
}

beforeEach(() => owner());
afterEach(() => {
	suspendResourceScope();
	vi.restoreAllMocks();
});

describe("resource assertion at the API boundary", () => {
	it("renews cached clients for a new verification epoch", () => {
		const create = vi.fn(() => new ApiClient());
		const cached = resourceScopedFactory(create);
		const first = cached();
		expect(cached()).toBe(first);
		owner();
		expect(cached()).not.toBe(first);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it("stops a multi-row save after its resource changes between writes", async () => {
		const fetcher = vi.fn<FetchLike>(async () =>
			response(JSON.stringify({ persisted: true, issues: [] })),
		);
		const client = new ApiClient({ fetch: fetcher });
		const createAccount = client.createAccount.bind(client);
		vi.spyOn(client, "createAccount").mockImplementation(
			async (row, options) => {
				const result = await createAccount(row, options);
				owner(B);
				return result;
			},
		);
		const result = await applyRowOperations(client, [
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
		expect(result).toBeInstanceOf(ResourceScopeError);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it.each(["json", "sse"] as const)(
		"does not retarget an old %s client to a different account",
		async (kind) => {
			const fetcher = vi.fn<FetchLike>(async () => response("{}", B));
			const client = new ApiClient({ fetch: fetcher });
			owner(B);
			expect(await request(client, kind)).toBeInstanceOf(ResourceScopeError);
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it("does not send a canceled save after the same plan is verified again", async () => {
		const fetcher = vi.fn<FetchLike>(async () => response("{}"));
		const client = new ApiClient({ fetch: fetcher });
		owner(A);
		expect(await client.createAccount({} as never)).toBeInstanceOf(
			ResourceScopeError,
		);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each(["json", "sse"] as const)(
		"blocks %s before network access while discovery is pending",
		async (kind) => {
			suspendResourceScope();
			const fetcher = vi.fn<FetchLike>();
			expect(
				await request(new ApiClient({ fetch: fetcher }), kind),
			).toBeInstanceOf(ResourceScopeError);
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it("sends the verified assertion, credentials, and redirect policy instead of caller assertions", async () => {
		const fetcher = vi.fn<FetchLike>(async () => response());
		const result = await new ApiClient({ fetch: fetcher }).getModel({
			headers: { "X-Waypoint-Resource": B },
		});
		expect(result).toEqual({ private: "account-a" });
		const init = fetcher.mock.calls[0]![1]!;
		expect(new Headers(init.headers).get("X-Waypoint-Resource")).toBe(A);
		expect(init).toMatchObject({
			credentials: "same-origin",
			redirect: "error",
			cache: "no-store",
		});
	});

	it.each(["https://unrelated.example", "/unverified-proxy"])(
		"does not attach scoped credentials to %s",
		async (baseUrl) => {
			const fetcher = vi.fn<FetchLike>();
			expect(
				await new ApiClient({ baseUrl, fetch: fetcher }).getModel(),
			).toBeInstanceOf(ResourceScopeError);
			expect(fetcher).not.toHaveBeenCalled();
			expect(getResourceScope().status).toBe("ready");
		},
	);

	it("accepts equivalent relative and absolute API bases", async () => {
		owner(A, "/proxy/");
		const fetcher = vi.fn<FetchLike>(async () => response());
		expect(
			await new ApiClient({
				baseUrl: canonicalApiBaseUrl("/proxy"),
				fetch: fetcher,
			}).getModel(),
		).toEqual({ private: "account-a" });
	});

	it.each([null, B])(
		"rejects a successful response with resource header %s and requests verification",
		async (resource) => {
			const check = vi.fn();
			window.addEventListener("waypoint:authentication-required", check);
			try {
				const result = await new ApiClient({
					fetch: async () => response(undefined, resource),
				}).getModel();
				expect(result).toBeInstanceOf(ResourceScopeError);
				expect(getResourceScope().status).toBe("pending");
				expect(check).toHaveBeenCalledOnce();
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
			const fetcher = vi.fn<FetchLike>(async (_url, init) => {
				signal = init?.signal;
				return new Promise<Response>((resolve) => {
					finish = resolve;
				});
			});
			const pending = request(new ApiClient({ fetch: fetcher }), kind);
			owner(B);
			expect(signal?.aborted).toBe(true);
			const cancel = vi.fn();
			finish(
				new Response(new ReadableStream({ cancel }), {
					headers: { "X-Waypoint-Resource": A },
				}),
			);
			expect(await pending).toBeInstanceOf(ResourceScopeError);
			expect(cancel).toHaveBeenCalledOnce();
			expect(getResourceScope().resource?.id).toBe(B);
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
		const client = new ApiClient({
			fetch: async () =>
				new Response(body, {
					headers: {
						"X-Waypoint-Resource": A,
						"content-type": "application/json",
					},
				}),
		});
		const pending = client.getModel();
		await reading;
		// Let the fetch continuation attach the guarded body before changing identity.
		await Promise.resolve();
		owner(B);
		expect(await pending).toBeInstanceOf(ResourceScopeError);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("terminates an already-returned SSE stream when the resource changes", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		const result = await new ApiClient({
			fetch: async () =>
				new Response(body, {
					headers: {
						"X-Waypoint-Resource": A,
						"content-type": "text/event-stream",
					},
				}),
		}).projectStochastic({} as never);
		expect(result).toBeInstanceOf(Response);
		if (!(result instanceof Response)) throw result;
		const reader = result.body!.getReader();
		const pending = reader.read();
		owner(B);
		await expect(pending).rejects.toBeInstanceOf(ResourceScopeError);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("forwards caller cancellation to the fetch and stream without a resource change", async () => {
		const caller = new AbortController();
		const cancel = vi.fn();
		let signal: AbortSignal | null | undefined;
		const client = new ApiClient({
			fetch: async (_url, init) => {
				signal = init?.signal;
				return new Response(new ReadableStream({ cancel }), {
					headers: { "X-Waypoint-Resource": A },
				});
			},
		});
		const result = await client.projectStochastic({} as never, {
			signal: caller.signal,
		});
		if (!(result instanceof Response)) throw result;
		const pending = result.body!.getReader().read();
		caller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(signal?.aborted).toBe(true);
		expect(cancel).toHaveBeenCalledOnce();
		expect(getResourceScope().status).toBe("ready");
	});

	it.each(["json", "sse"] as const)(
		"preserves ordinary %s HTTP failures without a session recheck",
		async (kind) => {
			for (const status of [401, 403, 409, 503]) {
				const scope = getResourceScope();
				const result = await request(
					new ApiClient({ fetch: async () => response("{}", A, status) }),
					kind,
				);
				expect(result).toBeInstanceOf(ApiHttpError);
				expect(result).toMatchObject({ status });
				expect(getResourceScope()).toBe(scope);
			}
		},
	);

	it.each(["json", "sse"] as const)(
		"rechecks %s only after the server reports RESOURCE_CHANGED",
		async (kind) => {
			const fetcher = vi.fn<FetchLike>(async (_url, init) => {
				expect(new Headers(init?.headers).get("X-Waypoint-Resource")).toBe(A);
				return response(
					JSON.stringify({ status: 409, code: "RESOURCE_CHANGED" }),
					B,
					409,
				);
			});
			const result = await request(new ApiClient({ fetch: fetcher }), kind);
			expect(result).toBeInstanceOf(ResourceScopeError);
			expect(getResourceScope().status).toBe("pending");
			expect(fetcher).toHaveBeenCalledOnce();
		},
	);

	it.each([null, A, B])(
		"preserves a duplicate-row conflict with resource header %s",
		async (resource) => {
			const scope = getResourceScope();
			const problem = { status: 409, detail: "That account already exists." };
			const result = await new ApiClient({
				fetch: async () => response(JSON.stringify(problem), resource, 409),
			}).createAccount({} as never);
			expect(result).toBeInstanceOf(ApiHttpError);
			expect(result).toMatchObject({ status: 409, problem });
			expect((result as ApiHttpError).message).toBe(
				"The request conflicts with the current server data. That account already exists.",
			);
			expect(getResourceScope()).toBe(scope);
		},
	);

	it("preserves a non-409 failure even with a resource-change code", async () => {
		const scope = getResourceScope();
		const result = await new ApiClient({
			fetch: async () =>
				response(
					JSON.stringify({ status: 503, code: "RESOURCE_CHANGED" }),
					A,
					503,
				),
		}).getModel();
		expect(result).toBeInstanceOf(ApiHttpError);
		expect(result).toMatchObject({ status: 503 });
		expect(getResourceScope()).toBe(scope);
	});

	it("preserves an operation conflict with another problem code", async () => {
		const scope = getResourceScope();
		const problem = { status: 409, code: "ID_CONFLICT" };
		const result = await new ApiClient({
			fetch: async () => response(JSON.stringify(problem), A, 409),
		}).createAccount({} as never);
		expect(result).toBeInstanceOf(ApiHttpError);
		expect(result).toMatchObject({ status: 409, problem });
		expect(getResourceScope()).toBe(scope);
	});

	it("does not invalidate a new workspace for an old resource-change error", () => {
		const oldScope = getResourceScope();
		const current = owner(B);
		const result = scopedResponseError(
			oldScope,
			new ApiHttpError({
				message: "The active plan changed.",
				status: 409,
				problem: { status: 409, code: "RESOURCE_CHANGED" },
			}),
		);
		expect(result).toBeInstanceOf(ResourceScopeError);
		expect(getResourceScope()).toBe(current);
	});
});
