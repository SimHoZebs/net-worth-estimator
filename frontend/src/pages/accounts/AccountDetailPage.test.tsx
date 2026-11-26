import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../domain/model.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { AccountDetailView } from "./AccountDetailPage.tsx";

const accountEditMock = vi.hoisted(() => vi.fn());

vi.mock("../../components/activity/useAccountEdit.ts", () => ({
	useAccountEdit: accountEditMock,
}));
vi.mock("../../state/useRemoteProjection.ts", () => ({
	DEFAULT_PROJECTION_YEARS: 10,
	useRemoteProjection: () => ({
		base: null,
		loading: false,
		baseError: null,
		retryProjection: vi.fn(),
	}),
}));
vi.mock("../../state/workspaceResources.ts", () => ({
	useSchedules: () => ({
		data: { schedules: [] },
		isPending: false,
		isError: false,
		refetch: vi.fn(),
	}),
}));
vi.mock("../../state/cardKindSuggestion.ts", () => ({
	useCardKindSuggestion: () => ({
		finding: null,
		dismissing: false,
		dismiss: vi.fn(),
	}),
}));
vi.mock("../../state/useUserScope.ts", () => ({
	useUserReadOnly: () => false,
}));
vi.mock("../../state/savedState.ts", () => ({
	useSavedAccounts: vi.fn(),
	useSavedStartDate: vi.fn(),
	useSavedTransactions: vi.fn(),
}));
vi.mock("../../workspace/useWorkspaceOverlays.ts", () => ({
	useWorkspaceOverlays: () => ({ openEditor: vi.fn() }),
}));
vi.mock("../../components/activity/AccountDetails.tsx", () => ({
	AccountDetails: () => <div>Account settings</div>,
}));
vi.mock("../../components/activity/AccountStatements.tsx", () => ({
	AccountStatements: () => <div>Account statements</div>,
}));
vi.mock("../../components/activity/LoanDetails.tsx", () => ({
	LoanDetails: () => <div>Loan settings</div>,
}));
vi.mock("../../components/activity/CardKindSuggestion.tsx", () => ({
	CardKindSuggestion: () => null,
	focusAccountKindPicker: vi.fn(),
}));
vi.mock("../../components/activity/RecurringRules.tsx", () => ({
	RecurringRules: () => <div>Recurring rules</div>,
}));
vi.mock("../../components/activity/Transactions.tsx", () => ({
	Transactions: ({ occurrences }: { occurrences: { name: string }[] }) => (
		<section aria-label="Account transactions">
			<ul>
				{occurrences.map((occurrence) => (
					<li key={occurrence.name}>{occurrence.name}</li>
				))}
			</ul>
		</section>
	),
}));

function editStub(account: Account) {
	return {
		draft: {
			name: account.name,
			balance: String(account.balance),
			kind: account.kind,
			enabled: account.enabled,
			displayBasis: account.displayBasis ?? "available",
			minBalance: String(account.minBalance),
			maxBalance: account.maxBalance === null ? "" : String(account.maxBalance),
			noCeiling: account.maxBalance === null,
			minimumFixed: "",
			minimumPercent: "",
			dueDay: "",
			statementClosingDay: String(account.statementClosingDay ?? 19),
		},
		formId: "account-form",
		activeField: null,
		update: vi.fn(),
		submit: vi.fn(),
		reset: vi.fn(),
		clearTerms: vi.fn(),
		error: null,
		saving: false,
		dirty: false,
		confirmCancel: false,
		setConfirmCancel: vi.fn(),
		observedAt: null,
		setObservedAt: vi.fn(),
		balanceAtTime: undefined,
		balanceAtTimeQuery: {
			isFetching: false,
			isPending: false,
			isError: false,
			refetch: vi.fn(),
		},
		saveBlocked: false,
	};
}

const baseAccount = financialModelFixture.accounts.find(
	(account) => account.id === "checking",
)!;
const transaction = financialModelFixture.transactions.find(
	(row) =>
		row.kind === "transaction" &&
		row.startDate <= financialModelFixture.startDate &&
		(row.fromId === baseAccount.id || row.toId === baseAccount.id),
)!;

beforeEach(() => {
	accountEditMock.mockReset();
});

describe("account detail authoritative balances", () => {
	it.each(["available", "posted"] as const)(
		"styles both recorded balances identically with %s basis",
		(displayBasis) => {
			const account: Account = {
				...baseAccount,
				name: "Amazon Credit Card",
				kind: "credit_card",
				balance: -276,
				observedBalance: -276,
				availableBalance: 0,
				displayBasis,
				readOnly: true,
			};
			accountEditMock.mockReturnValue(editStub(account));
			const { container } = render(
				<AccountDetailView
					account={account}
					accounts={[account]}
					transactions={[]}
					startDate={financialModelFixture.startDate}
					readOnly={false}
					onClose={vi.fn()}
					onEdit={vi.fn()}
				/>,
			);
			const labels = Array.from(container.querySelectorAll("dt"));
			expect(labels.map((label) => label.textContent)).toEqual([
				"Available balance",
				"Posted balance",
			]);
			const available = labels[0]!.nextElementSibling!;
			const posted = labels[1]!.nextElementSibling!;
			expect(available.textContent).toBe("$0");
			expect(posted.textContent).toBe("-$276");
			expect(available.className).toBe(posted.className);
			expect(available.className).toContain(
				"text-lg font-semibold tabular-nums text-foreground",
			);
		},
	);

	it("renders a manual posted balance and transactions without adjustment UI", () => {
		const account: Account = {
			...baseAccount,
			balance: 1250,
			observedBalance: 1250,
			availableBalance: null,
			readOnly: false,
		};
		accountEditMock.mockReturnValue(editStub(account));
		const { container } = render(
			<AccountDetailView
				account={account}
				accounts={[account]}
				transactions={[transaction]}
				startDate={financialModelFixture.startDate}
				readOnly={false}
				onClose={vi.fn()}
				onEdit={vi.fn()}
			/>,
		);
		expect(
			(screen.getByLabelText("Balance (USD)") as HTMLInputElement).value,
		).toBe("1250");
		expect(screen.getByText(transaction.name)).toBeTruthy();
		expect(
			screen.queryByRole("region", { name: "Balance history" }),
		).toBeNull();
		expect(container.textContent).not.toMatch(
			/adjustment|previous balance|balance history|manual entry|synced balance check/i,
		);
		expect(accountEditMock).toHaveBeenCalledWith(account, false, false);
	});

	it("renders a synced posted balance without adjustment or source labels", () => {
		const account: Account = {
			...baseAccount,
			balance: 980,
			observedBalance: 980,
			observedAt: 1773133200,
			availableBalance: null,
			displayBasis: "posted",
			readOnly: true,
			source: "Synced balance check",
			institution: "Fixture Bank",
		};
		accountEditMock.mockReturnValue(editStub(account));
		const { container } = render(
			<AccountDetailView
				account={account}
				accounts={[account]}
				transactions={[transaction]}
				startDate={financialModelFixture.startDate}
				readOnly={false}
				onClose={vi.fn()}
				onEdit={vi.fn()}
			/>,
		);
		expect(screen.getByText("Posted balance")).toBeTruthy();
		expect(screen.queryByLabelText("Balance (USD)")).toBeNull();
		expect(
			screen.queryByRole("region", { name: "Balance history" }),
		).toBeNull();
		expect(container.textContent).not.toMatch(
			/adjustment|previous balance|balance history|manual entry|synced balance check|bank balance/i,
		);
		expect(accountEditMock).toHaveBeenCalledWith(account, true, true);
	});
});
