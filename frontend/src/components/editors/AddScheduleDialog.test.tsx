import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AmountTemplate } from "../../api/contracts.ts";
import { WorkspaceEditor } from "../WorkspaceEditor.tsx";

const mocks = vi.hoisted(() => ({
	createSchedule: vi.fn(),
	performSave: vi.fn(),
	templates: [] as AmountTemplate[],
	accounts: [
		{
			id: "checking",
			name: "Checking",
			kind: "cash",
			enabled: true,
			color: null,
			minBalance: null,
			maxBalance: null,
			statementClosingDay: 0,
		},
		{
			id: "brokerage",
			name: "Brokerage",
			kind: "investment",
			enabled: true,
			color: null,
			minBalance: null,
			maxBalance: null,
			statementClosingDay: 0,
		},
		{
			id: "card",
			name: "Card",
			kind: "credit_card",
			enabled: true,
			color: null,
			minBalance: null,
			maxBalance: null,
			statementClosingDay: 0,
		},
	],
	schedules: [
		{
			id: "salary",
			name: "Salary",
			priority: 4,
			startDate: "2026-01-06",
			endDate: null,
			recurrence: { unit: "week", interval: 2, weekdays: [2] },
		},
	],
}));

vi.mock("@/api/generated/endpoints.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/api/generated/endpoints.ts")>()),
	createSchedule: mocks.createSchedule,
}));
vi.mock("../../state/workspaceWrites.ts", () => ({
	performSave: mocks.performSave,
}));
vi.mock("../../state/workspaceResources.ts", () => ({
	refreshTransactions: vi.fn(),
	useSchedules: () => ({ data: { schedules: mocks.schedules } }),
	useTransactionCatalog: () => ({ data: { items: [] } }),
}));
vi.mock("../../state/savedState.ts", () => ({
	useSavedAccounts: () => mocks.accounts,
	useSavedStartDate: () => "2026-01-01",
}));
vi.mock("./amountTemplates.ts", () => ({
	useAmountTemplates: () => mocks.templates,
}));

const fixed: AmountTemplate = {
	id: "fixed",
	label: "Fixed amount",
	amount: { resolver: "expression", config: { expression: "500" }, inputs: {} },
};
const accountPercent: AmountTemplate = {
	id: "account-percent",
	label: "Percent of account",
	amount: {
		resolver: "expression",
		config: { expression: "balance * pct" },
		inputs: {
			balance: {
				source: "provider",
				provider: "account-balance",
				arguments: { id: "brokerage" },
			},
			pct: { source: "literal", value: 0.04 },
		},
	},
};
const custom: AmountTemplate = {
	id: "bonus",
	label: "Yearly bonus",
	amount: {
		resolver: "expression",
		config: { expression: "base * 2" },
		inputs: {
			base: {
				source: "provider",
				provider: "model-value",
				arguments: { id: "salary" },
			},
		},
	},
};
const investment: AmountTemplate = {
	id: "investment-growth",
	label: "Investment growth",
	amount: {
		resolver: "expression",
		config: { expression: "brokerage * rate" },
		inputs: {
			brokerage: {
				source: "provider",
				provider: "model-value",
				arguments: { id: "old-transaction" },
			},
			rate: {
				source: "provider",
				provider: "occurrence-rate",
				arguments: { annualRate: 0.07, volatility: 0.12 },
			},
		},
	},
};
const owedBalance: AmountTemplate = {
	id: "owed-balance",
	label: "Pay the balance owed",
	amount: {
		resolver: "expression",
		config: { expression: "(abs(balance) - balance) / 2" },
		inputs: {
			balance: {
				source: "provider",
				provider: "account-balance",
				arguments: { id: "card" },
			},
		},
	},
};
const schedulePercent: AmountTemplate = {
	id: "schedule-percent",
	label: "Percent of another schedule",
	amount: {
		resolver: "expression",
		config: { expression: "base * share" },
		inputs: {
			base: {
				source: "provider",
				provider: "model-value",
				arguments: { id: "salary" },
			},
			share: { source: "literal", value: 0.1 },
		},
	},
};

async function selectOption(label: string, option: string) {
	const user = userEvent.setup();
	const trigger = screen.getByLabelText(label);
	await user.click(trigger);
	const item = await screen.findByRole(
		"option",
		{ name: option },
		{ timeout: 10000 },
	);
	await user.click(item);
}

function renderScheduleEditor() {
	const target = { kind: "schedule" as const, item: null };
	const rendered = render(
		<WorkspaceEditor target={target} onClose={vi.fn()} />,
	);
	return {
		...rendered,
		refresh: () =>
			rendered.rerender(
				<WorkspaceEditor
					target={{ kind: "schedule", item: null }}
					onClose={vi.fn()}
				/>,
			),
	};
}

async function submitSchedule(name: string, destination: string) {
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Schedule name"), name);
	await selectOption("To", destination);
	await user.click(screen.getByRole("button", { name: "Add schedule" }));
	await waitFor(() => expect(mocks.createSchedule).toHaveBeenCalledOnce());
	return mocks.createSchedule.mock.calls[0]![0];
}

async function expectNoSchedulePost(
	name: string,
	destination: string,
	errorMessage: string,
) {
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Schedule name"), name);
	await selectOption("To", destination);
	await user.click(screen.getByRole("button", { name: "Add schedule" }));
	expect(await screen.findByText(errorMessage)).toBeTruthy();
	expect(mocks.createSchedule).not.toHaveBeenCalled();
	expect(mocks.performSave).not.toHaveBeenCalled();
}

beforeEach(() => {
	mocks.createSchedule.mockReset().mockResolvedValue({ data: { saved: true } });
	mocks.performSave
		.mockReset()
		.mockImplementation(async ({ call }: { call: () => Promise<unknown> }) => {
			await call();
			return true;
		});
	mocks.templates = [
		fixed,
		accountPercent,
		custom,
		investment,
		owedBalance,
		schedulePercent,
	];
});

describe("schedule amount presets", () => {
	it(
		"offers a saved custom preset and submits its stored definition",
		{ timeout: 15000 },
		async () => {
			renderScheduleEditor();
			await selectOption("What kind of amount?", "Yearly bonus");
			const body = await submitSchedule("Annual bonus", "Checking");
			expect(body.amount).toMatchObject({
				resolver: "expression",
				config: { expression: "base * 2" },
				inputs: {
					base: {
						provider: "model-value",
						arguments: { id: "salary" },
					},
				},
			});
		},
	);

	it("keeps the selected preset across entry rerenders and preset refreshes", async () => {
		const editor = renderScheduleEditor();
		await selectOption("What kind of amount?", "Investment growth");
		await selectOption("Balance to grow", "Brokerage");
		mocks.templates = [
			fixed,
			custom,
			{
				...investment,
				amount: {
					...investment.amount!,
					inputs: {
						...investment.amount!.inputs,
						brokerage: {
							source: "provider",
							provider: "account-balance",
							arguments: { id: "brokerage" },
						},
					},
				},
			},
			owedBalance,
			schedulePercent,
		];
		editor.refresh();
		expect(screen.getByLabelText("What kind of amount?").textContent).toContain(
			"Investment growth",
		);
		expect(screen.getByLabelText("Balance to grow").textContent).toContain(
			"Brokerage",
		);
		const user = userEvent.setup();
		await user.type(screen.getByLabelText("Schedule name"), "Market growth");
		await selectOption("To", "Brokerage");
		editor.refresh();
		await user.click(screen.getByRole("button", { name: "Add schedule" }));
		await waitFor(() => expect(mocks.createSchedule).toHaveBeenCalledOnce());
		const body = mocks.createSchedule.mock.calls[0]![0];
		expect(body.amount).toMatchObject({
			inputs: {
				brokerage: {
					provider: "account-balance",
					arguments: { id: "brokerage" },
				},
			},
		});
	});

	it("retains the owed-balance choice for debt accounts", async () => {
		renderScheduleEditor();
		await selectOption("What kind of amount?", "Pay the balance owed");
		await selectOption("Debt account", "Card");
		const body = await submitSchedule("Pay off card", "Checking");
		expect(body.amount).toMatchObject({
			config: { expression: "(abs(balance) - balance) / 2" },
			inputs: {
				balance: {
					provider: "account-balance",
					arguments: { id: "card" },
				},
			},
		});
	});

	it("retains schedule-percent source timing and automatic priority", async () => {
		renderScheduleEditor();
		await selectOption("What kind of amount?", "Percent of another schedule");
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Use source timing" }));
		expect(
			(screen.getByLabelText("First occurrence") as HTMLInputElement).value,
		).toBe("2026-01-06");
		expect(
			(screen.getByLabelText("Repeat every") as HTMLInputElement).value,
		).toBe("2");
		const body = await submitSchedule("Employer match", "Checking");
		expect(body.amount).toMatchObject({
			inputs: {
				base: {
					provider: "model-value",
					arguments: { id: "salary" },
				},
			},
		});
		expect(body.priority).toBe(5);
	});

	it("does not POST a cleared fixed amount as the $500 fallback", async () => {
		const editor = renderScheduleEditor();
		await userEvent.setup().clear(screen.getByLabelText("Dollars each time"));
		editor.refresh();
		expect(
			(screen.getByLabelText("Dollars each time") as HTMLInputElement).value,
		).toBe("");
		await expectNoSchedulePost(
			"Blank fixed",
			"Checking",
			"Enter amount (usd).",
		);
	});

	it("does not POST a negative fixed amount", async () => {
		renderScheduleEditor();
		const user = userEvent.setup();
		await user.clear(screen.getByLabelText("Dollars each time"));
		await user.type(screen.getByLabelText("Dollars each time"), "-1");
		await expectNoSchedulePost(
			"Negative fixed",
			"Checking",
			"Review amount (usd).",
		);
		expect(mocks.createSchedule).not.toHaveBeenCalled();
	});

	it("does not POST a negative account percentage", async () => {
		renderScheduleEditor();
		await selectOption("What kind of amount?", "Percent of account");
		await selectOption("Account", "Brokerage");
		const user = userEvent.setup();
		await user.clear(screen.getByLabelText("Percent (0.04 = 4%)"));
		await user.type(screen.getByLabelText("Percent (0.04 = 4%)"), "-0.01");
		await expectNoSchedulePost(
			"Negative percentage",
			"Checking",
			"Review percentage (%).",
		);
		expect(mocks.createSchedule).not.toHaveBeenCalled();
	});

	it.each([
		["Yearly rate (0.07 = 7%)", "1.01", "Review annual return (%)."],
		[
			"Wobble (0 = exact, 0.12 = bumpy)",
			"-0.01",
			"Review annual volatility (%).",
		],
	])("does not POST out-of-bounds %s", async (label, value, message) => {
		renderScheduleEditor();
		await selectOption("What kind of amount?", "Investment growth");
		await selectOption("Balance to grow", "Brokerage");
		const user = userEvent.setup();
		await user.clear(screen.getByLabelText(label));
		await user.type(screen.getByLabelText(label), value);
		await expectNoSchedulePost("Invalid growth", "Brokerage", message);
		expect(mocks.createSchedule).not.toHaveBeenCalled();
	});

	it("does not POST schedule-percent without a valid source schedule", async () => {
		renderScheduleEditor();
		await selectOption("What kind of amount?", "Percent of another schedule");
		await selectOption("Based on schedule", "Pick a schedule");
		await expectNoSchedulePost(
			"Missing source",
			"Checking",
			"Choose a schedule.",
		);
		expect(mocks.createSchedule).not.toHaveBeenCalled();
	});

	it("does not POST investment growth without a valid balance account", async () => {
		renderScheduleEditor();
		await selectOption("What kind of amount?", "Investment growth");
		await selectOption("Balance to grow", "Pick an account");
		await expectNoSchedulePost(
			"Missing account",
			"Checking",
			"Choose an account.",
		);
		expect(mocks.createSchedule).not.toHaveBeenCalled();
	});
});
