import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "@/auth/resourceScope.ts";
import {
	buildFiConfig,
	fiConfigureState,
	IndependenceConfigure,
} from "./IndependenceConfigure.tsx";

const summaryState = vi.hoisted(() => ({
	summary: null as unknown,
	pending: false,
}));
const balancesState = vi.hoisted(() => ({
	accounts: [] as { id: string; name: string; kind: string; color: null }[],
	pending: false,
}));
const catalogState = vi.hoisted(() => ({
	items: [] as { id: string; kind: string; name: string }[],
	pending: false,
}));
const statusState = vi.hoisted(() => ({ readOnly: false }));
const writesState = vi.hoisted(() => ({
	saved: [] as { instanceId: string; input: unknown }[],
	result: true,
}));

vi.mock("@/state/evaluationQueries.ts", () => ({
	useEvaluationSummary: () => ({
		data: summaryState.summary,
		isPending: summaryState.pending,
		isFetching: summaryState.pending,
	}),
}));

vi.mock("@/state/workspaceResources.ts", () => ({
	useAccountBalances: () => ({
		data: { accounts: balancesState.accounts },
		isPending: balancesState.pending,
		isFetching: balancesState.pending,
	}),
	useTransactionCatalog: () => ({
		data: { items: catalogState.items },
		isPending: catalogState.pending,
		isFetching: catalogState.pending,
	}),
	useServerStatus: () => ({ data: { readOnly: statusState.readOnly } }),
	refreshEvaluations: vi.fn(async () => {}),
	workspaceIsBusy: () => false,
}));

vi.mock("@/api/generated/endpoints.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/api/generated/endpoints.ts")>();
	return {
		...actual,
		updateEvaluation: vi.fn(async (instanceId: string, body: unknown) => {
			writesState.saved.push({ instanceId, input: body });
			return {
				data: writesState.result
					? { persisted: true, issues: [], revision: "test" }
					: {
							persisted: false,
							issues: [{ severity: "error", message: "Choose an account." }],
							revision: "test",
						},
			};
		}),
	};
});

afterEach(() => {
	cleanup();
	summaryState.summary = null;
	summaryState.pending = false;
	balancesState.accounts = [];
	balancesState.pending = false;
	catalogState.items = [];
	catalogState.pending = false;
	statusState.readOnly = false;
	writesState.saved.length = 0;
	writesState.result = true;
	suspendUserScope();
	vi.clearAllMocks();
});

function seedServerState() {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/a",
				permissions: ["user:read", "user:write"],
			},
			subject: "users/a",
		},
		suspendUserScope(),
	);
	summaryState.summary = {
		evaluations: {
			financialIndependence: [
				{
					instanceId: "fi-1",
					name: "Financial independence",
					enabled: true,
					config: {
						minimumNetWorth: 1000,
						annualExpenseTarget: 80000,
						evaluationYears: 10,
						sources: [
							{ type: "asset", accountId: "brokerage", included: true },
						],
						continuingPostingIds: [],
					},
				},
			],
		},
		revision: "test",
	};
	balancesState.accounts = [
		{ id: "cash", name: "Cash", kind: "cash", color: null },
		{ id: "brokerage", name: "Brokerage", kind: "investment", color: null },
	];
	catalogState.items = [{ id: "salary", kind: "posting", name: "Salary" }];
}

describe("fiConfigureState", () => {
	it("parses minimum, duration, and selected funding sources", () => {
		const state = fiConfigureState({
			minimumNetWorth: 2500,
			evaluationYears: 15,
			sources: [
				{ type: "asset", accountId: "brokerage", included: true },
				{ type: "asset", accountId: "cash", included: false },
				{ type: "cashflow", postingId: "salary", included: true },
			],
		});
		expect(state.minimum).toBe(2500);
		expect(state.years).toBe(15);
		expect([...state.assets]).toEqual(["brokerage"]);
		expect([...state.income]).toEqual(["salary"]);
	});

	it("falls back when configuration is missing", () => {
		const state = fiConfigureState(undefined);
		expect(state.minimum).toBe(0);
		expect(state.years).toBe(10);
		expect(state.assets.size).toBe(0);
		expect(state.income.size).toBe(0);
	});
});

describe("buildFiConfig", () => {
	it("merges edits while preserving unrelated fields and overrides", () => {
		const next = buildFiConfig(
			{
				minimumNetWorth: 0,
				evaluationYears: 10,
				annualExpenseTarget: 80000,
				sources: [
					{
						type: "asset",
						accountId: "brokerage",
						included: true,
						withdrawalRateOverride: 0.05,
					},
				],
				continuingPostingIds: ["growth"],
			},
			{
				minimum: 5000,
				years: 12,
				assets: new Set(["brokerage", "cash"]),
				income: new Set(["salary"]),
			},
		);
		expect(next.minimumNetWorth).toBe(5000);
		expect(next.evaluationYears).toBe(12);
		expect(next.annualExpenseTarget).toBe(80000);
		expect(next.continuingPostingIds).toEqual(["growth"]);
		expect(next.sources).toEqual([
			{
				type: "asset",
				accountId: "brokerage",
				included: true,
				withdrawalRateOverride: 0.05,
			},
			{ type: "asset", accountId: "cash", included: true },
			{ type: "cashflow", postingId: "salary", included: true },
		]);
	});
});

describe("IndependenceConfigure", () => {
	it("shows unavailable state without a server evaluation", () => {
		const view = render(<IndependenceConfigure instanceId="fi-1" />);
		expect(view.getByText("Configuration unavailable.")).toBeTruthy();
	});

	it("shows loading state while the summary arrives", () => {
		summaryState.pending = true;
		const view = render(<IndependenceConfigure instanceId="fi-1" />);
		expect(view.getByText("Loading configuration…")).toBeTruthy();
	});

	it("edits minimum, duration, and funding sources then saves", async () => {
		seedServerState();
		const view = render(<IndependenceConfigure instanceId="fi-1" />);
		const minimum = view.getByLabelText(
			"Minimum net worth ($)",
		) as HTMLInputElement;
		const years = view.getByLabelText(
			"Spending test duration (years)",
		) as HTMLInputElement;
		expect(minimum.value).toBe("1000");
		expect(years.value).toBe("10");
		expect(
			view
				.getByRole("button", { name: /Brokerage/ })
				.getAttribute("aria-pressed"),
		).toBe("true");

		fireEvent.change(minimum, { target: { value: "5000" } });
		fireEvent.change(years, { target: { value: "12" } });
		fireEvent.click(view.getByRole("button", { name: /Cash/ }));
		fireEvent.click(view.getByRole("button", { name: /Salary/ }));
		fireEvent.click(view.getByRole("button", { name: "Save configuration" }));
		await view.findByText("Saved. Updating projection…");
		expect(writesState.saved).toHaveLength(1);
		expect(writesState.saved[0]?.instanceId).toBe("fi-1");
		const input = writesState.saved[0]?.input as {
			name: string;
			enabled: boolean;
			type: string;
			config: {
				minimumNetWorth: number;
				evaluationYears: number;
				sources: unknown;
			};
		};
		expect(input.name).toBe("Financial independence");
		expect(input.enabled).toBe(true);
		expect(input.type).toBe("financialIndependence");
		expect(input.config.minimumNetWorth).toBe(5000);
		expect(input.config.evaluationYears).toBe(12);
		expect(input.config.sources).toEqual([
			{ type: "asset", accountId: "brokerage", included: true },
			{ type: "asset", accountId: "cash", included: true },
			{ type: "cashflow", postingId: "salary", included: true },
		]);
	});

	it("shows an error when the row write fails", async () => {
		seedServerState();
		writesState.result = false;
		const view = render(<IndependenceConfigure instanceId="fi-1" />);
		fireEvent.click(view.getByRole("button", { name: "Save configuration" }));
		await view.findByText("The configuration could not be saved. Try again.");
		expect(view.queryByText("Saved. Updating projection…")).toBeNull();
	});
});
