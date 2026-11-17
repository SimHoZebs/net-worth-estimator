import { useMemo } from "react";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import { visibleAccounts } from "@/domain/model.ts";
import { checkingAccountId } from "@/domain/safeSpending.ts";
import {
	billCandidates as buildBillCandidates,
	effectiveBillIds,
} from "@/domain/safeSpendingBills.ts";
import {
	resolveEffectiveIds,
	toggleEffectiveId,
} from "@/domain/safeSpendingSelection.ts";
import { incomeSourceCandidates } from "@/domain/safeSpendingIncome.ts";
import type { TotalCycleSettings } from "@/state/useSafeSpendingSettings.ts";

/**
 * The one place that resolves and toggles the four user selections behind
 * safe spending. `null` means automatic for cards, cash accounts and bills;
 * income schedules keep their explicit list because an empty list means no
 * automatic income.
 */
export function useSafeSpendingSelections({
	accounts,
	rules,
	savedRules,
	settings,
	displayToday,
	updateSettings,
}: {
	accounts: Account[];
	rules: Transaction[];
	savedRules: Schedule[];
	settings: TotalCycleSettings;
	displayToday: string;
	updateSettings: (next: Partial<TotalCycleSettings>) => void;
}) {
	const { accountIds, spendingAccountIds, transactionIds, incomeScheduleIds } =
		settings;

	const candidateAccounts = useMemo(
		() => visibleAccounts(accounts),
		[accounts],
	);

	// Before a card designation exists the detected card accounts stay the
	// default; every toggle follows the same null-means-auto rule.
	const defaultCardIds = useMemo(() => {
		const debtAccounts = candidateAccounts.filter(
			(account) => account.kind === "debt",
		);
		const cardLike = debtAccounts
			.map((account) => account.id)
			.filter((id) => id.endsWith("_card"));
		return cardLike.length
			? cardLike
			: debtAccounts.map((account) => account.id);
	}, [candidateAccounts]);
	const trackedIds = useMemo(
		() =>
			resolveEffectiveIds(
				accountIds,
				candidateAccounts.map((account) => account.id),
				defaultCardIds,
			),
		[accountIds, candidateAccounts, defaultCardIds],
	);

	const spendableAccounts = useMemo(
		() => candidateAccounts.filter((account) => account.kind !== "debt"),
		[candidateAccounts],
	);
	const spendingIds = useMemo(() => {
		const knownIds = spendableAccounts.map((account) => account.id);
		const fallbackId = checkingAccountId(accounts);
		const fallback =
			fallbackId && knownIds.includes(fallbackId) ? [fallbackId] : [];
		return resolveEffectiveIds(spendingAccountIds, knownIds, fallback);
	}, [spendingAccountIds, spendableAccounts, accounts]);

	const incomeCandidates = useMemo(
		() =>
			incomeSourceCandidates({
				accounts,
				rules,
				spendingIds,
				incomeScheduleIds,
				today: displayToday,
			}),
		[accounts, rules, spendingIds, incomeScheduleIds, displayToday],
	);
	const billCandidates = useMemo(
		() => buildBillCandidates(savedRules, spendingIds),
		[savedRules, spendingIds],
	);
	const trackedBillIds = useMemo(
		() => effectiveBillIds(transactionIds, billCandidates),
		[transactionIds, billCandidates],
	);

	const toggleAccount = (accountId: string) =>
		updateSettings({
			accountIds: toggleEffectiveId(
				accountIds,
				candidateAccounts.map((account) => account.id),
				accountId,
				defaultCardIds,
			),
		});
	const toggleSpendingAccount = (accountId: string) => {
		const knownIds = spendableAccounts.map((account) => account.id);
		const fallbackId = checkingAccountId(accounts);
		const fallback =
			fallbackId && knownIds.includes(fallbackId) ? [fallbackId] : [];
		updateSettings({
			spendingAccountIds: toggleEffectiveId(
				spendingAccountIds,
				knownIds,
				accountId,
				fallback,
			),
		});
	};
	const toggleBill = (transactionId: string) =>
		updateSettings({
			transactionIds: toggleEffectiveId(
				transactionIds,
				billCandidates.map((bill) => bill.id),
				transactionId,
			),
		});
	// An empty explicit list is meaningful for income: it opts out of all
	// automatic income, so it must not collapse back to the automatic null.
	const toggleIncomeSource = (id: string) =>
		updateSettings({
			incomeScheduleIds: incomeScheduleIds.includes(id)
				? incomeScheduleIds.filter((item) => item !== id)
				: [...incomeScheduleIds, id],
		});

	return {
		candidateAccounts,
		trackedIds,
		spendableAccounts,
		spendingIds,
		incomeCandidates,
		billCandidates,
		trackedBillIds,
		toggleAccount,
		toggleSpendingAccount,
		toggleBill,
		toggleIncomeSource,
	};
}
