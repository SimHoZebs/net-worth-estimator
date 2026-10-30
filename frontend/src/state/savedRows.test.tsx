import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { stubTestServer } from "../mocks/waypointServer.ts";
import type {
	BackendPosting,
	FinancialModelDocument,
} from "../api/contracts.ts";
import { resetServerQueryCache } from "./serverQuery.ts";
import {
	useSavedAccounts,
	useSavedEvaluations,
	useSavedPurchases,
	useSavedStartDate,
	useSavedTransactions,
} from "./savedRows.ts";

function emptyDocument(): FinancialModelDocument {
	return {
		sourcePath: "models/empty",
		accounts: [],
		checkpoints: [],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			accountBalance: [],
			postingFulfillment: [],
			cycleFulfillment: [],
		},
		postings: [],
		recurrenceRules: [],
		plannedPurchases: [],
	};
}

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

describe("saved rows", () => {
	it("returns null while queries have no data, then saved rows", async () => {
		stubTestServer();
		const accounts = renderHook(() => useSavedAccounts());
		const transactions = renderHook(() => useSavedTransactions());
		const evaluations = renderHook(() => useSavedEvaluations());
		const purchases = renderHook(() => useSavedPurchases());
		const startDate = renderHook(() => useSavedStartDate());
		expect(accounts.result.current).toBeNull();
		expect(transactions.result.current).toBeNull();
		expect(evaluations.result.current).toBeNull();
		expect(purchases.result.current).toBeNull();
		expect(startDate.result.current).toBeNull();

		await waitFor(() => expect(accounts.result.current).not.toBeNull());
		expect(
			accounts.result.current?.map((account) => account.id).sort(),
		).toEqual(["cash", "loan"]);
		await waitFor(() => expect(transactions.result.current).not.toBeNull());
		expect(transactions.result.current?.map((row) => row.id)).toEqual([
			"salary",
		]);
		await waitFor(() => expect(evaluations.result.current).not.toBeNull());
		expect(evaluations.result.current).toMatchObject([
			{ id: "target", kind: "net-worth", target: 500 },
		]);
		await waitFor(() => expect(purchases.result.current).not.toBeNull());
		expect(purchases.result.current).toEqual([]);
		await waitFor(() => expect(startDate.result.current).not.toBeNull());
		expect(startDate.result.current).toBe("2026-01-31");
	});

	it("keeps the same output reference across rerenders with unchanged data", async () => {
		stubTestServer();
		const accounts = renderHook(() => useSavedAccounts());
		const transactions = renderHook(() => useSavedTransactions());
		const evaluations = renderHook(() => useSavedEvaluations());
		const purchases = renderHook(() => useSavedPurchases());
		const startDate = renderHook(() => useSavedStartDate());
		await waitFor(() => expect(accounts.result.current).not.toBeNull());
		await waitFor(() => expect(transactions.result.current).not.toBeNull());
		await waitFor(() => expect(evaluations.result.current).not.toBeNull());
		await waitFor(() => expect(purchases.result.current).not.toBeNull());
		await waitFor(() => expect(startDate.result.current).not.toBeNull());

		const firstAccounts = accounts.result.current;
		const firstTransactions = transactions.result.current;
		const firstEvaluations = evaluations.result.current;
		const firstPurchases = purchases.result.current;
		accounts.rerender();
		transactions.rerender();
		evaluations.rerender();
		purchases.rerender();
		startDate.rerender();
		expect(accounts.result.current).toBe(firstAccounts);
		expect(transactions.result.current).toBe(firstTransactions);
		expect(evaluations.result.current).toBe(firstEvaluations);
		expect(purchases.result.current).toBe(firstPurchases);
	});

	it("returns loaded-empty arrays for a blank model instead of null", async () => {
		stubTestServer(undefined, emptyDocument());
		const accounts = renderHook(() => useSavedAccounts());
		const transactions = renderHook(() => useSavedTransactions());
		const evaluations = renderHook(() => useSavedEvaluations());
		const purchases = renderHook(() => useSavedPurchases());
		await waitFor(() => expect(accounts.result.current).not.toBeNull());
		await waitFor(() => expect(transactions.result.current).not.toBeNull());
		await waitFor(() => expect(evaluations.result.current).not.toBeNull());
		await waitFor(() => expect(purchases.result.current).not.toBeNull());
		expect(accounts.result.current).toEqual([]);
		expect(transactions.result.current).toEqual([]);
		expect(evaluations.result.current).toEqual([]);
		expect(purchases.result.current).toEqual([]);
	});

	it("reads the purchase queue from legacy purchase-marker postings", async () => {
		const laptop: BackendPosting = {
			id: "laptop",
			name: "Laptop",
			sourceAccountId: "cash",
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "500" },
				inputs: {},
			},
			postedTime: 1769904000,
			transactionTime: 1769904000,
			purchase: { priority: 1 },
			enabled: true,
		};
		const chair: BackendPosting = {
			...laptop,
			id: "chair",
			name: "Chair",
			amount: {
				resolver: "expression",
				config: { expression: "150" },
				inputs: {},
			},
			purchase: { priority: 0 },
		};
		const plain: BackendPosting = {
			...laptop,
			id: "plain",
			name: "Plain outflow",
			purchase: null,
		};
		stubTestServer(undefined, {
			...emptyDocument(),
			postings: [laptop, plain, chair],
		});
		const purchases = renderHook(() => useSavedPurchases());
		await waitFor(() => expect(purchases.result.current).not.toBeNull());
		// Priority order, plain postings ignored: the queue is visible even
		// though the backend still persists wishlist rows as postings.
		expect(purchases.result.current).toEqual([
			{
				id: "chair",
				name: "Chair",
				amount: 150,
				fromId: "cash",
				startDate: "2026-02-01",
				enabled: true,
				readOnly: false,
			},
			{
				id: "laptop",
				name: "Laptop",
				amount: 500,
				fromId: "cash",
				startDate: "2026-02-01",
				enabled: true,
				readOnly: false,
			},
		]);
	});

	it("dedupes standalone and legacy rows for the same purchase", async () => {
		const legacy: BackendPosting = {
			id: "laptop",
			name: "Laptop",
			sourceAccountId: "cash",
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "999" },
				inputs: {},
			},
			postedTime: 1769904000,
			transactionTime: 1769904000,
			purchase: { priority: 4 },
			enabled: true,
		};
		stubTestServer(undefined, {
			...emptyDocument(),
			postings: [legacy],
			plannedPurchases: [
				{
					id: "laptop",
					name: "Laptop",
					fundingAccountId: "cash",
					cost: 500,
					earliestDate: "2026-03-01",
					enabled: true,
					priority: 0,
				},
			],
		});
		const purchases = renderHook(() => useSavedPurchases());
		await waitFor(() => expect(purchases.result.current).not.toBeNull());
		// The canonical standalone row wins; the legacy mirror collapses.
		expect(purchases.result.current).toEqual([
			{
				id: "laptop",
				name: "Laptop",
				amount: 500,
				fromId: "cash",
				startDate: "2026-03-01",
				enabled: true,
				readOnly: false,
			},
		]);
	});
});
