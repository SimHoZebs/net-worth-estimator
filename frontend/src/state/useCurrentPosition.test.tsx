import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { FinancialModelDocument } from "../api/contracts.ts";
import type { CurrentPositionResponse } from "../api/position.ts";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { useCurrentPosition } from "./useCurrentPosition.ts";
import { resetWorkspaceStore } from "./workspaceStore.ts";

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	suspendResourceScope();
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
	cache = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
	});
}
const result = {
	asOfDate: "2026-01-01",
	netWorth: 100,
	accounts: [{ accountId: "cash", balance: 100 }],
};

it("exposes pending then success without any forecast request", async () => {
	setup();
	let resolve!: (response: CurrentPositionResponse) => void;
	const client = {
		getCurrentPosition: vi.fn(
			() =>
				new Promise<CurrentPositionResponse>((done) => {
					resolve = done;
				}),
		),
	};
	const hook = renderHook(
		() =>
			useCurrentPosition({ client, document: model(), draftDocument: null }),
		{ wrapper },
	);
	expect(hook.result.current.status).toBe("pending");
	await act(async () => {
		resolve({ result });
	});
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data).toEqual(result);
	expect(client.getCurrentPosition).toHaveBeenCalledOnce();
});

it("clears previous-input data while the new position is pending", async () => {
	setup();
	const client = {
		getCurrentPosition: vi
			.fn()
			.mockResolvedValueOnce({ result })
			.mockImplementation(() => new Promise(() => {})),
	};
	const hook = renderHook(
		({ document }) =>
			useCurrentPosition({ client, document, draftDocument: null }),
		{ wrapper, initialProps: { document: model() } },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	hook.rerender({ document: model(200) });
	expect(hook.result.current.status).toBe("pending");
	expect(hook.result.current.data).toBeNull();
});

it("exposes errors and retries explicitly", async () => {
	setup();
	const client = {
		getCurrentPosition: vi
			.fn()
			.mockResolvedValueOnce({
				issues: [{ severity: "error", message: "Invalid history" }],
			})
			.mockResolvedValue({ result }),
	};
	const hook = renderHook(
		() =>
			useCurrentPosition({ client, document: model(), draftDocument: null }),
		{ wrapper },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("error"));
	expect(hook.result.current.error).toBe("Invalid history");
	act(() => hook.result.current.retry());
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
});

it("does not request a disabled position", () => {
	setup();
	const client = { getCurrentPosition: vi.fn() };
	const hook = renderHook(
		() =>
			useCurrentPosition({
				client,
				document: model(),
				draftDocument: null,
				enabled: false,
			}),
		{ wrapper },
	);
	expect(hook.result.current.status).toBe("disabled");
	expect(client.getCurrentPosition).not.toHaveBeenCalled();
});

it("requests the draft model in preference to the saved model", async () => {
	setup();
	const saved = model(100);
	const draft = model(200);
	const client = { getCurrentPosition: vi.fn().mockResolvedValue({ result }) };
	const hook = renderHook(
		() => useCurrentPosition({ client, document: saved, draftDocument: draft }),
		{ wrapper },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(client.getCurrentPosition.mock.calls[0]?.[0]).toEqual({
		document: draft,
		asOfDate: "2026-01-01",
	});
});

it("separates identical models by resource identity", async () => {
	setup();
	const selectScope = (id: string) =>
		acceptResourceScope(
			{
				apiBaseUrl: "http://localhost",
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
	const client = { getCurrentPosition: vi.fn().mockResolvedValue({ result }) };
	const hook = renderHook(
		() =>
			useCurrentPosition({ client, document: model(), draftDocument: null }),
		{ wrapper },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	selectScope("plans/two");
	hook.rerender();
	expect(hook.result.current.data).toBeNull();
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(client.getCurrentPosition).toHaveBeenCalledTimes(2);
});
