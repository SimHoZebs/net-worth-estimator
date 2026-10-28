import { useMemo } from "react";
import { AccountToggle } from "../../../components/AccountToggle.tsx";
import { InputField } from "../../../components/Field.tsx";
import type { Plan } from "../../../domain/model.ts";
import type { SafeSpendingIncome } from "../../../domain/safeSpendingIncome.ts";
import type { TotalCycleSettings } from "../../../state/useSafeSpendingSettings.ts";
import { clampStatementDay } from "../../../state/useSafeSpendingSettings.ts";
import type {
	BillCandidate,
	SafeSpendingConfigHints,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { IncomeSourcesFieldset } from "./IncomeSourcesFieldset.tsx";
import { formatRuleDetail, TogglePill } from "./TogglePill.tsx";

export function SafeSpendingConfigurePanel({
	config,
	income,
	billCandidates,
	trackedBillIds,
	accounts,
	onToggleBill,
	onToggleAccount,
	onToggleSpendingAccount,
	onToggleIncomeAccount,
	onUpdateConfig,
}: {
	config: SafeSpendingConfigHints;
	income: SafeSpendingIncome;
	billCandidates: BillCandidate[];
	trackedBillIds: string[];
	accounts: Plan["accounts"];
	onToggleBill: (movementId: string) => void;
	onToggleAccount: (accountId: string) => void;
	onToggleSpendingAccount: (accountId: string) => void;
	onToggleIncomeAccount: (accountId: string) => void;
	onUpdateConfig: (next: Partial<TotalCycleSettings>) => void;
}) {
	const accountsById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	return (
		<div className="grid content-start gap-3">
			<InputField
				label={`${labels.cycleStart} (1–28)`}
				type="number"
				min={1}
				max={28}
				value={config.statementDay}
				onChange={(event) =>
					onUpdateConfig({
						statementDay: clampStatementDay(event.target.value),
						statementDaySet: true,
					})
				}
			/>
			<InputField
				label={`${labels.reserve} ($)`}
				type="number"
				min={0}
				step="0.01"
				value={config.reserve}
				onChange={(event) =>
					onUpdateConfig({
						reserve: Math.max(0, Number(event.target.value) || 0),
					})
				}
			/>
			<fieldset className="grid gap-3">
				<legend className="m-0 mb-1 p-0 text-xs font-semibold text-muted">
					Income accounts
				</legend>
				<div className="flex flex-wrap gap-2">
					{config.incomeAccounts.map((account) => {
						const full = accountsById.get(account.id);
						const checked = config.trackedIncomeIds.includes(account.id);
						if (!full) return null;
						return (
							<AccountToggle
								key={account.id}
								account={full}
								checked={checked}
								onToggle={() => onToggleIncomeAccount(account.id)}
							/>
						);
					})}
				</div>
			</fieldset>
			<IncomeSourcesFieldset
				income={income}
				onChange={(incomeRuleIds) => onUpdateConfig({ incomeRuleIds })}
			/>
			<fieldset className="grid gap-3">
				<legend className="m-0 mb-1 p-0 text-xs font-semibold text-muted">
					{labels.cashAccounts}
				</legend>
				<div className="flex flex-wrap gap-2">
					{config.spendingAccounts.map((account) => {
						const full = accountsById.get(account.id);
						const checked = config.trackedSpendingIds.includes(account.id);
						if (!full) return null;
						return (
							<AccountToggle
								key={account.id}
								account={full}
								checked={checked}
								onToggle={() => onToggleSpendingAccount(account.id)}
							/>
						);
					})}
				</div>
			</fieldset>
			<fieldset className="grid gap-3">
				<legend className="m-0 mb-1 p-0 text-xs font-semibold text-muted">
					Tracked cards
				</legend>
				<div className="flex flex-wrap gap-2">
					{config.cards.map((card) => {
						const full = accountsById.get(card.id);
						const checked = config.trackedIds.includes(card.id);
						if (!full) return null;
						return (
							<AccountToggle
								key={card.id}
								account={full}
								checked={checked}
								onToggle={() => onToggleAccount(card.id)}
							/>
						);
					})}
				</div>
			</fieldset>
			<fieldset className="grid gap-3">
				<legend className="m-0 mb-1 p-0 text-xs font-semibold text-muted">
					Included bills
				</legend>
				{billCandidates.length ? (
					<div className="flex flex-wrap gap-2">
						{billCandidates.map((bill) => (
							<TogglePill
								key={bill.id}
								name={bill.name}
								detail={formatRuleDetail({ amount: bill.amount })}
								checked={trackedBillIds.includes(bill.id)}
								onToggle={() => onToggleBill(bill.id)}
							/>
						))}
					</div>
				) : (
					<p className="text-sm leading-relaxed text-muted">
						No recurring bills found for the selected cash accounts.
					</p>
				)}
			</fieldset>
		</div>
	);
}
