import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../../domain/model.ts";
import { projectionFixture } from "../../../mocks/projection.ts";
import {
	useSavedAccounts,
	useSavedSchedules,
	useSavedStartDate,
	useSavedTransactions,
} from "../../../state/savedState.ts";
import { useSafeSpendingSettings } from "../../../state/useSafeSpendingSettings.ts";
import { useUserReadOnly } from "../../../state/useUserScope.ts";
import { useCheckpoints } from "../../../state/workspaceResources.ts";
import { useOutlookProjection } from "@/pages/outlook/useOutlookProjection.ts";
import { SafeSpendingPreview } from "./SafeSpendingPreview.tsx";

vi.mock("@/state/savedState.ts", () => ({
	useSavedAccounts: vi.fn(),
	useSavedTransactions: vi.fn(),
	useSavedSchedules: vi.fn(),
	useSavedStartDate: vi.fn(),
}));
vi.mock("@/state/useUserScope.ts", () => ({
	useUserReadOnly: vi.fn(),
}));
vi.mock("@/state/workspaceResources.ts", () => ({
	useCheckpoints: vi.fn(),
}));
vi.mock("@/pages/outlook/useOutlookProjection.ts", () => ({
	useOutlookProjection: vi.fn(),
}));
vi.mock("@/state/useSafeSpendingSettings.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/state/useSafeSpendingSettings.ts")>();
	return { ...actual, useSafeSpendingSettings: vi.fn() };
});

const accounts: Account[] = [
	{
		id: "checking",
		name: "Everyday checking",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 4200,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Balance check",
		readOnly: false,
	},
	{
		id: "card",
		name: "Credit card",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: -500,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Balance check",
		readOnly: false,
	},
];

const settings = {
	statementDay: 20,
	reserve: 725,
	accountIds: null as string[] | null,
	spendingAccountIds: null,
	incomeAccountIds: null,
	incomeScheduleIds: [] as string[],
	transactionIds: null,
	statementDaySet: false,
	pending: false,
	error: false,
	updateSettings: vi.fn(),
	retry: vi.fn(),
};

function primeWorkspace() {
	vi.mocked(useSavedAccounts).mockReturnValue(accounts);
	vi.mocked(useSavedTransactions).mockReturnValue([]);
	vi.mocked(useSavedSchedules).mockReturnValue([]);
	vi.mocked(useSavedStartDate).mockReturnValue("2026-01-31");
	vi.mocked(useUserReadOnly).mockReturnValue(false);
	vi.mocked(useCheckpoints).mockReturnValue({
		data: { checkpoints: [] },
	} as unknown as ReturnType<typeof useCheckpoints>);
	vi.mocked(useOutlookProjection).mockReturnValue({
		base: projectionFixture(),
		pending: false,
	} as ReturnType<typeof useOutlookProjection>);
	vi.mocked(useSafeSpendingSettings).mockReturnValue(settings);
}

beforeEach(() => {
	primeWorkspace();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("SafeSpendingPreview", () => {
	it("offers a card designation when no debt account exists", () => {
		const onDetail = vi.fn();
		render(
			<SafeSpendingPreview
				detail={null}
				onDetail={onDetail}
				onTabChange={vi.fn()}
			/>,
		);
		const choose = screen.getByRole("button", { name: "Choose a card" });
		expect(choose).toBeTruthy();
		fireEvent.click(choose);
		expect(onDetail).toHaveBeenCalledWith("configure");
	});

	it("tracks a designated cash account without a debt account", () => {
		vi.mocked(useSafeSpendingSettings).mockReturnValue({
			...settings,
			accountIds: ["card"],
		});
		render(
			<SafeSpendingPreview
				detail={null}
				onDetail={vi.fn()}
				onTabChange={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "This cycle transactions" }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Choose a card" })).toBeNull();
	});

	it("keeps the default tracked set on debt accounts when a cash account looks like a card", () => {
		vi.mocked(useSavedAccounts).mockReturnValue([
			...accounts,
			{
				id: "loan",
				name: "Student loan",
				kind: "debt",
				enabled: true,
				archived: false,
				balance: -18000,
				minBalance: 0,
				maxBalance: 0,
				color: null,
				observedOn: "2026-01-31",
				balanceCheck: true,
				source: "Balance check",
				readOnly: false,
			},
			{
				id: "cash_card",
				name: "Cash card",
				kind: "cash",
				enabled: true,
				archived: false,
				balance: 100,
				minBalance: 0,
				maxBalance: null,
				color: null,
				observedOn: "2026-01-31",
				balanceCheck: true,
				source: "Balance check",
				readOnly: false,
			},
		]);
		render(
			<SafeSpendingPreview
				detail="configure"
				onDetail={vi.fn()}
				onTabChange={vi.fn()}
			/>,
		);
		const drawer = screen.getByRole("dialog", { name: "Safe card spending" });
		const tracked = within(drawer).getByRole("group", {
			name: "Tracked cards",
		});
		expect(
			within(tracked)
				.getByRole("button", { name: /Student loan/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			within(tracked)
				.getByRole("button", { name: /Cash card/ })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});
});
