import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildFiConfig,
	fiConfigureState,
	IndependenceConfigure,
} from "./IndependenceConfigure.tsx";

const modelState = vi.hoisted(() => ({
	document: null as unknown,
	readOnly: false,
}));
const endpointState = vi.hoisted(() => ({
	saved: [] as { instanceId: string; body: unknown }[],
}));

vi.mock("@/state/workspaceResources.ts", () => ({
	useServerModel: () => ({ data: { document: modelState.document } }),
	useServerStatus: () => ({ data: { readOnly: modelState.readOnly } }),
	reloadWorkspace: vi.fn(async () => {}),
}));

vi.mock("@/api/generated/endpoints.ts", () => ({
	updateEvaluation: vi.fn(async (instanceId: string, body: unknown) => {
		endpointState.saved.push({ instanceId, body });
		return { data: { persisted: true }, status: 200, headers: new Headers() };
	}),
}));

afterEach(() => {
	cleanup();
	modelState.document = null;
	modelState.readOnly = false;
	endpointState.saved.length = 0;
	vi.clearAllMocks();
});

function seedDocument() {
	modelState.document = {
		accounts: [
			{ id: "cash", name: "Cash", kind: "cash", color: null },
			{ id: "brokerage", name: "Brokerage", kind: "investment", color: null },
		],
		postings: [{ id: "salary", name: "Salary" }],
		recurrenceRules: [],
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
	};
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

	it("edits minimum, duration, and funding sources then saves", async () => {
		seedDocument();
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
		expect(endpointState.saved).toHaveLength(1);
		const body = endpointState.saved[0]!.body as {
			config: {
				minimumNetWorth: number;
				evaluationYears: number;
				sources: unknown;
			};
		};
		expect(body.config.minimumNetWorth).toBe(5000);
		expect(body.config.evaluationYears).toBe(12);
		expect(body.config.sources).toEqual([
			{ type: "asset", accountId: "brokerage", included: true },
			{ type: "asset", accountId: "cash", included: true },
			{ type: "cashflow", postingId: "salary", included: true },
		]);
	});
});
