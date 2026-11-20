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
	settings: SafeSpendingSettings;
	displayToday: string;
	updateSettings: (next: Partial<SafeSpendingSettings>) => void;
}) {
	const { accountIds, spendingAccountIds, transactionIds, incomeScheduleIds } =
		settings;

	const candidateAccounts = useMemo(
		() => visibleAccounts(accounts),
		[accounts],
	);
	const cards = useMemo(() => safeSpendingCards(accounts), [accounts]);
	const cardIds = useMemo(() => cards.map(({ id }) => id), [cards]);
	const trackedIds = useMemo(
		() => selectedCardIds(accountIds, cardIds),
		[accountIds, cardIds],
	);

	const spendableAccounts = useMemo(
		() => candidateAccounts.filter((account) => !isLiability(account)),
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
		cards,
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
