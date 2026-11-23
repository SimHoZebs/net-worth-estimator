import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { ok } from "../mocks/fetch.ts";
import {
	recordedRequests,
	setupQueryScope,
	teardownQueryScope,
	ServerQueryWrapper,
} from "../mocks/testScope.tsx";
import { useCardKindSuggestion } from "./cardKindSuggestion.ts";

function finding(): AnalysisFinding {
	return {
		analysisType: "card-kind",
		analyzerVersion: "v1",
		dismissed: false,
		evidence: [
			{
				code: "debt-balance",
				reason: "The balance behaves like a debt.",
				transactionIds: null,
			},
		],
		feedbackRevision: 0,
		firstDetectedAt: 1,
		id: "card-1",
		inputRevision: 1,
		kind: "credit_card",
		lastCheckedAt: 2,
		product: "",
		provider: "",
		role: "",
		runId: "run-1",
		stale: false,
		status: "active",
		strength: "strong",
		transactionId: "",
		accountId: "account-1",
	} as AnalysisFinding;
}

beforeEach(() => setupQueryScope());
afterEach(() => teardownQueryScope());

it("reads the suggestion for the viewed account only", async () => {
	const fetcher = vi.fn(async () =>
		ok({
			findings: [
				finding(),
				{ ...finding(), id: "other", accountId: "account-2" },
			],
			nextCursor: "",
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(() => useCardKindSuggestion("account-1", "cash"), {
		wrapper: ServerQueryWrapper,
	});
	await waitFor(() => expect(hook.result.current.finding?.id).toBe("card-1"));
	expect(hook.result.current.finding?.kind).toBe("credit_card");
	expect(
		recordedRequests(fetcher).filter((request) => request.method === "PATCH"),
	).toEqual([]);
});

it("dismisses through the existing finding endpoint and drops the card", async () => {
	let dismissed = false;
	let dismissBody: unknown;
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const path = String(url);
		if (init?.method === "PATCH" && path === "/v1/analysis-findings/card-1") {
			dismissBody = JSON.parse(String(init.body ?? "{}"));
			dismissed = true;
			return ok({});
		}
		return ok({ findings: dismissed ? [] : [finding()], nextCursor: "" });
	});
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(() => useCardKindSuggestion("account-1", "cash"), {
		wrapper: ServerQueryWrapper,
	});
	await waitFor(() => expect(hook.result.current.finding?.id).toBe("card-1"));
	await act(async () => {
		expect(await hook.result.current.dismiss()).toBe(true);
	});
	await waitFor(() => expect(hook.result.current.finding).toBeUndefined());
	expect(
		recordedRequests(fetcher).some(
			(request) =>
				request.url === "/v1/analysis-findings/card-1" &&
				request.method === "PATCH",
		),
	).toBe(true);
	expect(dismissBody).toEqual({ dismissed: true });
});

it("keeps the declared kind authoritative when it already matches", async () => {
	const fetcher = vi.fn(async () =>
		ok({ findings: [finding()], nextCursor: "" }),
	);
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(
		() => useCardKindSuggestion("account-1", "credit_card"),
		{ wrapper: ServerQueryWrapper },
	);
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	expect(hook.result.current.finding).toBeUndefined();
});
