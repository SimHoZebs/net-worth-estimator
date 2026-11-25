import { useMemo } from "react";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import { visibleAccounts } from "@/domain/model.ts";
import {
	checkingAccountId,
	safeSpendingCards,
	selectedCardIds,
} from "@/domain/safeSpending.ts";
import { isLiability } from "@/domain/accountKinds.ts";
import {
	billCandidates as buildBillCandidates,
	effectiveBillIds,
} from "@/domain/safeSpendingBills.ts";
import {
	resolveEffectiveIds,
	toggleEffectiveId,
} from "@/domain/safeSpendingSelection.ts";
import { incomeSourceCandidates } from "@/domain/safeSpendingIncome.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";

type SafeSpendingSelectionInput = {
	accounts: Account[];
	rules: Transaction[];
	savedRules: Schedule[];
	settings: SafeSpendingSettings;
	displayToday: string;
};

/** Pure resolution shared by persisted evidence and the Configure draft. */
export function resolveSafeSpendingSelections({
	accounts,
	rules,
	savedRules,
	settings,
	displayToday,
}: SafeSpendingSelectionInput) {
	const { accountIds, spendingAccountIds, transactionIds, incomeScheduleIds } =
		settings;
	const candidateAccounts = visibleAccounts(accounts);
	const cards = safeSpendingCards(accounts);
	const cardIds = cards.map(({ id }) => id);
	const trackedIds = selectedCardIds(accountIds, cardIds);
	const spendableAccounts = candidateAccounts.filter(
		(account) => !isLiability(account),
	);
	const knownSpendingIds = spendableAccounts.map((account) => account.id);
	const fallbackId = checkingAccountId(accounts);
	const fallback =
		fallbackId && knownSpendingIds.includes(fallbackId) ? [fallbackId] : [];
	const spendingIds = resolveEffectiveIds(
		spendingAccountIds,
		knownSpendingIds,
		fallback,
	);
	const incomeCandidates = incomeSourceCandidates({
		accounts,
		rules,
		spendingIds,
		incomeScheduleIds,
		today: displayToday,
	});
	const billCandidates = buildBillCandidates(savedRules, spendingIds);
	const trackedBillIds = effectiveBillIds(transactionIds, billCandidates);
	return {
		cards,
		trackedIds,
		spendableAccounts,
		spendingIds,
		incomeCandidates,
		billCandidates,
		trackedBillIds,
	};
}

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
}: SafeSpendingSelectionInput & {
	updateSettings: (next: Partial<SafeSpendingSettings>) => void;
}) {
	const selections = useMemo(
		() =>
			resolveSafeSpendingSelections({
				accounts,
				rules,
				savedRules,
				settings,
				displayToday,
			}),
		[accounts, rules, savedRules, settings, displayToday],
	);
	const { trackedIds, spendableAccounts, billCandidates } = selections;

	const toggleAccount = (accountId: string) => {
		const next = trackedIds.includes(accountId)
			? trackedIds.filter((id) => id !== accountId)
			: [...trackedIds, accountId];
		updateSettings({ accountIds: next });
	};
	const toggleSpendingAccount = (accountId: string) => {
		const knownIds = spendableAccounts.map((account) => account.id);
		const fallbackId = checkingAccountId(accounts);
		const fallback =
			fallbackId && knownIds.includes(fallbackId) ? [fallbackId] : [];
		updateSettings({
			spendingAccountIds: toggleEffectiveId(
				settings.spendingAccountIds,
				knownIds,
				accountId,
				fallback,
			),
		});
	};
	const toggleBill = (transactionId: string) =>
		updateSettings({
			transactionIds: toggleEffectiveId(
				settings.transactionIds,
				billCandidates.map((bill) => bill.id),
				transactionId,
			),
		});
	// An empty explicit list is meaningful for income: it opts out of all
	// automatic income, so it must not collapse back to the automatic null.
	const toggleIncomeSource = (id: string) =>
		updateSettings({
			incomeScheduleIds: settings.incomeScheduleIds.includes(id)
				? settings.incomeScheduleIds.filter((item) => item !== id)
				: [...settings.incomeScheduleIds, id],
		});

	return {
		...selections,
		toggleAccount,
		toggleSpendingAccount,
		toggleBill,
		toggleIncomeSource,
	};
}
