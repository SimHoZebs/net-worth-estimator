import { afterEach, expect, it, vi } from "vitest";
import {
	clearResourceQueryCache,
	cancelResourceQueries,
	resetServerQueryCache,
	serverQueryClient,
} from "@/state/serverQuery.ts";
import { discoverSession } from "./sessionDiscovery.ts";

const A = `users/${"a".repeat(64)}`;
type SessionBody = {
	enabled: true;
	authenticated: boolean;
	allowed: boolean;
	resource: { id: string; permissions: string[] };
	user: { subject: string; name: string };
};

function body(id = A): SessionBody {
	return {
		enabled: true,
		authenticated: true,
		allowed: true,
		resource: { id, permissions: ["user:read", "user:project"] },
		user: { subject: id, name: "Account" },
	};
}

function response(session = body()) {
	return new Response(JSON.stringify(session), {
		headers: {
			"content-type": "application/json",
			"Waypoint-Resource": session.resource.id,
		},
	});
}

function fetcher() {
	const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
		response(),
	);
	vi.stubGlobal("fetch", mock);
	return mock;
}

afterEach(() => {
	resetServerQueryCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("discovers through the shared cache and retains no session body", async () => {
	const mock = fetcher();
	const session = await discoverSession(new AbortController().signal);
	expect(session.resource.id).toBe(A);
	expect(mock).toHaveBeenCalledOnce();
	await vi.waitFor(() =>
		expect(serverQueryClient().getQueryCache().getAll()).toHaveLength(0),
	);
});

it("checks again instead of reusing a completed discovery", async () => {
	const mock = fetcher();
	await discoverSession(new AbortController().signal);
	await discoverSession(new AbortController().signal);
	expect(mock).toHaveBeenCalledTimes(2);
});

it("survives resource cache eviction while discovery is in flight", async () => {
	let finish: (value: Response) => void = () => {};
	let signal: AbortSignal | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return new Promise<Response>((resolve) => {
				finish = resolve;
			});
		}),
	);
	const pending = discoverSession(new AbortController().signal);
	await vi.waitFor(() => expect(typeof finish).toBe("function"));
	await clearResourceQueryCache();
	await cancelResourceQueries();
	expect(signal?.aborted).toBe(false);
	finish(response());
	await expect(pending).resolves.toMatchObject({
		resource: { id: A },
		user: { subject: A },
	});
});

it("aborts discovery when its caller retires the check", async () => {
	const controller = new AbortController();
	let signal: AbortSignal | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return new Promise<Response>(() => {});
		}),
	);
	const pending = discoverSession(controller.signal);
	await vi.waitFor(() => expect(signal).toBeDefined());
	controller.abort();
	await expect(pending).rejects.toBeInstanceOf(Error);
	expect(signal?.aborted).toBe(true);
});
