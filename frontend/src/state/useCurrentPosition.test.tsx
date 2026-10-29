import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { FinancialModelDocument } from "../api/contracts.ts";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	getResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { useCurrentPosition } from "./useCurrentPosition.ts";
import { resetWorkspaceStore } from "./workspaceStore.ts";

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	suspendResourceScope();
	vi.unstubAllGlobals();
});

function model(balance = 100): FinancialModelDocument {
	return {
		sourcePath: "",
		accounts: [],
		postings: [],
		recurrenceRules: [],
		checkpoints: [{ AccountId: "cash", Date: "2026-01-01", Balance: balance }],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			postingFulfillment: [],
			cycleFulfillment: [],
			accountBalance: [],
		},
	};
}

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}
let cache: QueryClient;

function setup() {
	acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: `plans/${"a".repeat(64)}`,
				kind: "private",
				permissions: ["plan:read"],
			},
			subject: `plans/${"a".repeat(64)}`,
		},
		suspendResourceScope(),
	)!;
	cache = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
	});
}

const result = {
	asOfDate: "2026-01-01",
	netWorth: 100,
	accounts: [{ accountId: "cash", balance: 100 }],
};

function stubPosition(respond: (url: string, init?: RequestInit) => unknown) {
	const calls: { url: string; init?: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			const headers = new Headers({ "content-type": "application/json" });
			const resource = getResourceScope().resource?.id;
			if (resource) headers.set("Waypoint-Resource", resource);
			const body = await respond(String(url), init);
			return new Response(JSON.stringify(body), { headers });
		}),
	);
	return calls;
}

it("exposes pending then success without any forecast request", async () => {
	setup();
	let finish!: (value: unknown) => void;
	const pending = new Promise<unknown>((resolve) => {
		finish = resolve;
	});
	let calls = 0;
	stubPosition(() => {
		calls += 1;
		return calls === 1 ? pending : { result };
	});
	const hook = renderHook(
		() => useCurrentPosition({ document: model() }),
		{ wrapper },
	);
	expect(hook.result.current.status).toBe("pending");
	await act(async () => {
		finish({ result });
	});
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data).toEqual(result);
});

it("clears previous-input data while the new position is pending", async () => {
	setup();
	let gate = false;
	stubPosition(() => {
		if (!gate) return { result };
		return new Promise(() => {});
	});
	const hook = renderHook(
		({ document }) => useCurrentPosition({ document }),
		{ wrapper, initialProps: { document: model() } },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	gate = true;
	hook.rerender({ document: model(200) });
	expect(hook.result.current.status).toBe("pending");
	expect(hook.result.current.data).toBeNull();
});

it("exposes errors and retries explicitly", async () => {
	setup();
	let attempts = 0;
	stubPosition(() => {
		attempts += 1;
		if (attempts === 1)
			return { issues: [{ severity: "error", message: "Invalid history" }] };
		return { result };
	});
	const hook = renderHook(
		() => useCurrentPosition({ document: model() }),
		{ wrapper },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("error"));
	expect(hook.result.current.error).toBe("Invalid history");
	act(() => hook.result.current.retry());
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
});

it("does not request a disabled position", () => {
	setup();
	const calls: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (...args: unknown[]) => {
			calls.push(args);
			throw new Error("unexpected fetch");
		}),
	);
	const hook = renderHook(
		() =>
			useCurrentPosition({
				document: model(),
				enabled: false,
			}),
		{ wrapper },
	);
	expect(hook.result.current.status).toBe("disabled");
	expect(calls).toHaveLength(0);
});

it("requests the saved model", async () => {
	setup();
	const bodies: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body ?? "{}")));
			const headers = new Headers({ "content-type": "application/json" });
			const resource = getResourceScope().resource?.id;
			if (resource) headers.set("Waypoint-Resource", resource);
			return new Response(JSON.stringify({ result }), { headers });
		}),
	);
	const saved = model(100);
	const hook = renderHook(() => useCurrentPosition({ document: saved }), {
		wrapper,
	});
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(bodies).toHaveLength(1);
	expect(bodies[0]).toMatchObject({ asOfDate: "2026-01-01" });
	expect(
		(bodies[0] as { document?: { checkpoints?: unknown[] } }).document,
	).toEqual(saved);
});

it("separates identical models by resource identity", async () => {
	setup();
	const seen: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			seen.push(getResourceScope().resource?.id ?? "");
			const headers = new Headers({ "content-type": "application/json" });
			const resource = getResourceScope().resource?.id;
			if (resource) headers.set("Waypoint-Resource", resource);
			return new Response(JSON.stringify({ result }), { headers });
		}),
	);
	const selectScope = (id: string) =>
		acceptResourceScope(
			{
				apiBaseUrl: canonicalApiBaseUrl(""),
				subject: null,
				resource: {
					id,
					kind: "sample",
					permissions: ["plan:read", "plan:project"],
				},
			},
			suspendResourceScope(),
		);
	selectScope("plans/one");
	const hook = renderHook(
		() => useCurrentPosition({ document: model() }),
		{ wrapper },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	selectScope("plans/two");
	hook.rerender();
	expect(hook.result.current.data).toBeNull();
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(seen).toEqual(["plans/one", "plans/two"]);
});

it("ignores workspace drafts and requests the saved model", async () => {
	setup();
	const bodies: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body ?? "{}")));
			const headers = new Headers({ "content-type": "application/json" });
			const resource = getResourceScope().resource?.id;
			if (resource) headers.set("Waypoint-Resource", resource);
			return new Response(JSON.stringify({ result }), { headers });
		}),
	);
	const { useWorkspaceStore } = await import("./workspaceStore.ts");
	useWorkspaceStore.setState({
		draft: {
			schemaVersion: 1,
			name: "Draft marker",
			origin: "personal",
			startDate: "2026-01-01",
			updatedAt: new Date().toISOString(),
			revision: 1,
			readOnly: false,
			accounts: [
				{
					id: "draft-acc",
					name: "Draft",
					kind: "cash",
					balance: 200,
					minBalance: 0,
					maxBalance: null,
					color: null,
					observedOn: "2026-01-01",
					balanceCheck: false,
					source: "Manual entry",
					readOnly: false,
				},
			],
			transactions: [],
			plannedPurchases: [],
			evaluations: [],
			assumptions: { inflation: 2, volatility: 0 },
		} as never,
	});
	const saved = model(100);
	const hook = renderHook(() => useCurrentPosition({ document: saved }), {
		wrapper,
	});
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(bodies).toHaveLength(1);
	expect(
		(bodies[0] as { document?: { checkpoints?: unknown[] } }).document,
	).toEqual(saved);
});
